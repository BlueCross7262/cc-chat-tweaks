import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  ModelEffort,
  PromptSubmitInput,
  Register,
  RenderInputOf,
  RenderSurface,
} from 'claude-code'

import type { Flow, Phase } from '../types'
import {
  callLog,
  CLASSIFY_LOG_PREFIX,
  classifyTail,
  parseTypes,
  allAnswered,
  answer,
  answeredCount,
  askInput,
  begin,
  buildContext,
  clip,
  decideGate,
  EMPTY_FLOW,
  isStale,
  MIN_LEN,
  normalizeCompletion,
  parseMinLen,
  parseQuestions,
  reset,
  revised,
  squash,
  reviseInput,
  rewriteInput,
  SKIP_TTL_MS,
  toPhase,
  undo,
  withDraft,
  hasRecommended,
  withQuestions,
  withRecommended,
  withTook,
  tookText,
  unwrapDraft,
} from './upgrade-logic'
import { CALLS, CLASSIFY_SYSTEM, Q_SYSTEM, R_SYSTEM, REVISE_SYSTEM } from './upgrade-prompts'
import {
  DEFAULT_SILENT_OFF_TRIGGERS,
  DEFAULT_SILENT_TRIGGERS,
  describeFlags,
  effortOf,
  flagsOf,
  labelOf,
  minLengthOf,
  modelOf,
  SETTINGS_SOURCES,
  silentOffTriggersOf,
  silentTriggersOf,
  TYPE_EFFORT_KEY,
  TYPE_MODEL_KEY,
  type Flags,
} from './settings'

const PANE = 'prompt-upgrade'
const LOG_ROW_MAX = 2000

const flowAtom = atom({ plugin: 'cc-chat-tweaks', key: 'flow' } as const, EMPTY_FLOW)

const FAILED_NOTICE = 'Haiku did not answer. Showing the original prompt.'
const REVISE_FAILED_NOTICE = 'Haiku did not answer. The draft is unchanged.'

type Call = { model: string; effort: ModelEffort; maxTokens: number; timeoutMs: number }

type Timed = { text: string | null; ms: number }

const getFlow = ($: EngineInterface): Promise<Flow> => read($, flowAtom)

const setFlow = async ($: EngineInterface, fn: (f: Flow) => Flow): Promise<Flow> => {
  await update($, flowAtom, fn)

  return getFlow($)
}

const setIf = ($: EngineInterface, id: number, fn: (f: Flow) => Flow): Promise<Flow> =>
  setFlow($, f => (isStale(f, id) ? f : fn(f)))

const callWithSettings = async ($: EngineInterface, call: Call): Promise<Call> => {
  try {
    const sources = (await readSources($)).map(([, settings]) => settings)

    return { ...call, model: modelOf(sources) ?? call.model, effort: effortOf(sources) ?? call.effort }
  } catch {
    return call
  }
}

const callWithTypeSettings = async ($: EngineInterface, call: Call): Promise<Call> => {
  try {
    const sources = (await readSources($)).map(([, settings]) => settings)

    return {
      ...call,
      model: modelOf(sources, TYPE_MODEL_KEY) ?? call.model,
      effort: effortOf(sources, TYPE_EFFORT_KEY) ?? call.effort,
    }
  } catch {
    return call
  }
}

const writeLog = ($: EngineInterface, row: string): void => {
  try {
    $.ui.log(row)
  } catch {
    return
  }
}

const logCall = ($: EngineInterface, call: Call, ms: number, original: string): void =>
  writeLog($, callLog(call, ms, original, LOG_ROW_MAX))

const completeWith = async ($: EngineInterface, used: Call, system: string, prompt: string): Promise<Timed> => {
  const startedAt = await $.clock.now()
  let text: string | null = null
  try {
    text = normalizeCompletion(
      await $.model.complete({
        model: used.model,
        effort: used.effort,
        system,
        prompt,
        maxTokens: used.maxTokens,
        timeoutMs: used.timeoutMs,
      }),
    )
  } catch {
    text = null
  }
  const ms = Math.max(0, (await $.clock.now()) - startedAt)

  return { text, ms }
}

const callModel = async (
  $: EngineInterface,
  call: Call,
  system: string,
  prompt: string,
): Promise<Timed> => {
  const used = await callWithSettings($, call)
  const done = await completeWith($, used, system, prompt)
  logCall($, used, done.ms, (await getFlow($).catch(() => EMPTY_FLOW)).original)

  return done
}

const classify = async ($: EngineInterface, flow: Flow): Promise<string[]> => {
  try {
    const used = await callWithTypeSettings($, CALLS.classify)
    const done = await completeWith($, used, CLASSIFY_SYSTEM, askInput(flow))
    const types = parseTypes(done.text)
    writeLog($, callLog(used, done.ms, classifyTail(done.text === null ? null : types), LOG_ROW_MAX, CLASSIFY_LOG_PREFIX))

    return types
  } catch {
    return []
  }
}

const classifying = new Map<number, Promise<string[]>>()

const startClassify = ($: EngineInterface, flow: Flow): void => {
  classifying.clear()
  classifying.set(flow.runId, classify($, flow))
}

const takeTypes = (id: number, fallback: string[]): Promise<string[]> => classifying.get(id) ?? Promise.resolve(fallback)

const restoreText = async ($: EngineInterface, text: string): Promise<void> => {
  let isFilled = false
  try {
    // UNVERIFIED: whether prompt.fill succeeds while the Prompt Upgrade pane holds the keyboard
    isFilled = (await $.prompt.fill({ text })).isFilled
  } catch {
    isFilled = false
  }
  if (isFilled) return
  let isCopied = false
  try {
    isCopied = (await $.ui.copy({ text })).isCopied
  } catch {
    isCopied = false
  }
  $.ui.toast(
    isCopied
      ? 'Prompt Upgrade could not refill the prompt box. The full text is on your clipboard.'
      : `Prompt Upgrade could not refill the prompt box. Your text: ${text}`,
  )
}

const toOriginal = async ($: EngineInterface, id: number, notice: string): Promise<void> => {
  try {
    await setIf($, id, f => withDraft(f, f.original, notice))
  } catch {
    return
  }
}

const startAsk = async ($: EngineInterface, id: number, useQuestions: boolean): Promise<void> => {
  try {
    const f = await getFlow($)
    if (isStale(f, id)) return
    const asked = useQuestions ? await callModel($, CALLS.ask, Q_SYSTEM, askInput(f)) : null
    const questions = parseQuestions(asked?.text ?? null)
    const next = await setIf($, id, cur =>
      withQuestions(asked?.text ? withTook(cur, 'ask', asked.ms) : cur, questions),
    )
    if (isStale(next, id)) return
    if (questions.length === 0) await startRewrite($, id)
  } catch {
    await toOriginal($, id, FAILED_NOTICE)
  }
}

const startRewrite = async ($: EngineInterface, id: number): Promise<void> => {
  try {
    const loading = await setIf($, id, cur => toPhase(cur, 'rewriteLoading'))
    if (isStale(loading, id)) return
    const types = await takeTypes(id, loading.types ?? [])
    const f = await setIf($, id, cur => ({ ...cur, types }))
    if (isStale(f, id)) return
    const done = await callModel($, CALLS.rewrite, R_SYSTEM, rewriteInput(f))
    await setIf($, id, cur =>
      done.text === null
        ? withDraft(cur, cur.original, FAILED_NOTICE)
        : withTook(withDraft(cur, unwrapDraft(done.text)), 'rewrite', done.ms),
    )
  } catch {
    await toOriginal($, id, FAILED_NOTICE)
  }
}

const pick = async ($: EngineInterface, index: number, value: string): Promise<void> => {
  const f = await setFlow($, cur => (cur.phase === 'questions' ? answer(cur, index, value) : cur))
  if (f.phase === 'questions' && allAnswered(f)) await startRewrite($, f.runId)
}

const upgradeNow = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  if (f.phase === 'questions') await startRewrite($, f.runId)
}

const upgradeWithRecommended = async ($: EngineInterface): Promise<void> => {
  const f = await setFlow($, cur => (cur.phase === 'questions' ? withRecommended(cur) : cur))
  if (f.phase === 'questions') await startRewrite($, f.runId)
}

const revise = async ($: EngineInterface, request: string): Promise<void> => {
  const req = request.trim()
  const f = await getFlow($)
  if (req === '' || f.phase !== 'review') return
  const id = f.runId
  await setIf($, id, cur => ({ ...cur, phase: 'rewriteLoading', notice: '' }))
  try {
    const done = await callModel($, CALLS.revise, REVISE_SYSTEM, reviseInput(f.draft, req))
    await setIf($, id, cur =>
      done.text === null
        ? { ...cur, phase: 'review', notice: REVISE_FAILED_NOTICE }
        : withTook({ ...revised(cur, unwrapDraft(done.text)), phase: 'review', notice: '' }, 'revise', done.ms),
    )
  } catch {
    await setIf($, id, cur => ({ ...cur, phase: 'review', notice: REVISE_FAILED_NOTICE }))
  }
}

const undoRevision = async ($: EngineInterface): Promise<void> => {
  await setFlow($, cur => (cur.phase === 'review' ? undo(cur) : cur))
}

const cancel = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  await setFlow($, reset)
  await $.ui.close({ id: PANE }).catch(() => undefined)
  if (f.phase !== 'idle' && f.original !== '') await restoreText($, f.original)
}

const CLEAR_TRIES = 3
const CLEAR_WAIT_MS = 100
const BOX_SETTLE_MS = 300

const clearBox = async ($: EngineInterface): Promise<boolean> => {
  for (let i = 0; i < CLEAR_TRIES; i++) {
    let isCleared = false
    try {
      isCleared = (await $.prompt.fill({ text: '' })).isFilled
    } catch {
      isCleared = false
    }
    if (isCleared) return true
    if (i < CLEAR_TRIES - 1) await $.clock.sleep(CLEAR_WAIT_MS).catch(() => undefined)
  }

  return false
}

const finish = async ($: EngineInterface, text: string): Promise<void> => {
  const t = text.trim()
  if (t === '') {
    await cancel($)
    return
  }
  await setFlow($, f => ({ ...reset(f), pending: t }))
  await $.ui.close({ id: PANE }).catch(() => undefined)
  const isCleared = await clearBox($)
  // UNVERIFIED: the asUser resubmit reaches prompt.submit with text equal to the trimmed pending value
  $.prompt.submit({ text: t, asUser: true }).catch(() => restoreText($, t))
  if (!isCleared) await clearBox($)
}

const recoverSilent = async ($: EngineInterface, id: number): Promise<void> => {
  try {
    const f = await getFlow($)
    if (isStale(f, id)) return
    await setFlow($, reset)
    if (f.original !== '') await restoreText($, f.original)
  } catch {
    return
  }
}

const boxText = async ($: EngineInterface): Promise<string | null> => {
  try {
    return (await $.prompt.read()).text.trim()
  } catch {
    return null
  }
}

const isBoxFree = async ($: EngineInterface, typed: string, baseline: string | null): Promise<boolean> => {
  const current = await boxText($)

  return current === null || current === '' || current === typed.trim() || current === baseline
}

const fillDraft = async ($: EngineInterface, draft: string): Promise<void> => {
  const now = await $.clock.now()
  await setFlow($, cur => ({ ...reset(cur), skipUntil: now + SKIP_TTL_MS, filled: squash(draft) }))
  await restoreText($, draft)
}

const parkDraft = async ($: EngineInterface, draft: string): Promise<void> => {
  await setFlow($, reset)
  let isCopied = false
  try {
    isCopied = (await $.ui.copy({ text: draft })).isCopied
  } catch {
    isCopied = false
  }
  $.ui.toast(
    isCopied
      ? 'Prompt Upgrade left the prompt box alone because you typed in it. The upgraded prompt is on your clipboard.'
      : `Prompt Upgrade left the prompt box alone because you typed in it. Upgraded prompt: ${draft}`,
  )
}

const askAndApplyRecommended = async ($: EngineInterface, id: number): Promise<void> => {
  const f = await getFlow($)
  if (isStale(f, id)) return
  const asked = await callModel($, CALLS.ask, Q_SYSTEM, askInput(f))
  const questions = parseQuestions(asked.text)
  await setIf($, id, cur =>
    withRecommended(withQuestions(asked.text ? withTook(cur, 'ask', asked.ms) : cur, questions)),
  )
}

const runSilent = async ($: EngineInterface, id: number, typed: string, useQuestions: boolean): Promise<void> => {
  try {
    await $.clock.sleep(BOX_SETTLE_MS).catch(() => undefined)
    const baseline = await boxText($)
    if (useQuestions) await askAndApplyRecommended($, id)
    await startRewrite($, id)
    const f = await getFlow($)
    if (isStale(f, id) || f.phase !== 'review') return
    if (f.notice !== '') $.ui.toast(f.notice)
    if (await isBoxFree($, typed, baseline)) await fillDraft($, f.draft)
    else await parkDraft($, f.draft)
  } catch {
    await recoverSilent($, id)
  }
}

const finishDraft = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  if (f.phase === 'review') await finish($, f.draft)
}

const finishOriginal = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  if (f.phase !== 'idle') await finish($, f.original)
}

const editInPrompt = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  if (f.phase !== 'review') return
  const now = await $.clock.now()
  await setFlow($, cur => ({ ...reset(cur), skipUntil: now + SKIP_TTL_MS, filled: squash(f.draft) }))
  await $.ui.close({ id: PANE })
  await restoreText($, f.draft)
}

const onClosedByPerson = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  if (f.phase === 'idle') return
  await setFlow($, reset)
  if (f.original !== '') await restoreText($, f.original)
}

const onUnloaded = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  if (f.phase !== 'idle') await setFlow($, reset)
}

const recoverAfterReload = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  if (f.phase === 'idle') return
  await setFlow($, reset)
  await $.ui.close({ id: PANE })
  if (f.original !== '') $.ui.toast(`Prompt Upgrade reloaded and closed its pane. Your earlier prompt: ${f.original}`)
}

type PaneInput = RenderInputOf<'Pane', Exclude<RenderSurface, 'mobile'>>

const ACCENT = 'claude'
const RECOMMENDED = 'success'
const STEPS = ['Your prompt', 'Questions', 'Rewrite', 'Review']
const ORIGINAL_CLIP = 240
const DRAFT_CLIP = 9000

const stepOf = (phase: Phase): number => {
  if (phase === 'askLoading' || phase === 'questions') return 1
  if (phase === 'rewriteLoading') return 2
  if (phase === 'review') return 3
  return 0
}

const renderPane = ($: EngineInterface, e: PaneInput, flow: Flow) => {
  const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
  const current = stepOf(flow.phase)

  const stepper = (
    <Box justifyContent="space-between">
      <Box flexWrap="wrap">
        {STEPS.map((name, i) => (
          <Box>
            {i > 0 ? <Text dimColor>{' ── '}</Text> : null}
            {i < current ? (
              <Text color="success">{'✓ '}</Text>
            ) : i === current ? (
              <Text color={ACCENT}>{'● '}</Text>
            ) : (
              <Text dimColor>{'○ '}</Text>
            )}
            {i === current ? (
              <Text bold color={ACCENT}>
                {name}
              </Text>
            ) : (
              <Text dimColor={i > current}>{name}</Text>
            )}
          </Box>
        ))}
      </Box>
      {flow.phase === 'questions' ? (
        <Text dimColor>
          {answeredCount(flow)} of {flow.questions.length} answered
        </Text>
      ) : null}
    </Box>
  )

  const section = (title: string, hint: string) => (
    <Box justifyContent="space-between" marginTop={1}>
      <Text bold dimColor>
        {title}
      </Text>
      <Text dimColor>{hint}</Text>
    </Box>
  )

  const cancelButton = <Button label="취소" hotkey="c" dimColor role="dismiss" onPress={() => cancel($)} />

  if (flow.phase === 'idle') {
    return (
      <Box flexDirection="column">
        <Text dimColor>No prompt is being upgraded.</Text>
      </Box>
    )
  }

  const header = (
    <Box flexDirection="column">
      {stepper}
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginTop={1}>
        <Text bold dimColor>
          YOUR PROMPT
        </Text>
        <Text>{clip(flow.original, ORIGINAL_CLIP)}</Text>
      </Box>
    </Box>
  )

  if (flow.phase === 'askLoading' || flow.phase === 'rewriteLoading') {
    return (
      <Box flexDirection="column">
        {header}
        <Box marginTop={1}>
          <Text color={ACCENT}>{'● '}</Text>
          <Text dimColor>
            {flow.phase === 'askLoading' ? 'Asking Haiku for questions...' : 'Haiku is writing the prompt...'}
          </Text>
        </Box>
        <Box marginTop={1}>{cancelButton}</Box>
      </Box>
    )
  }

  if (flow.phase === 'questions') {
    return (
      <Box flexDirection="column">
        {header}
        {section('A FEW QUICK QUESTIONS', 'pick one each, or skip')}
        {flow.questions.map((q, i) => {
          const given = flow.answers[String(i)]
          const isListed = given !== undefined && q.options.includes(given)

          return (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Text bold color="inverseText" backgroundColor={ACCENT}>
                  {` ${i + 1} `}
                </Text>
                <Text bold> {q.q}</Text>
              </Box>
              <Box flexDirection="column" alignItems="flex-start" marginLeft={4}>
                {q.options.map((value, j) => {
                  const isRecommended = j === q.recommended
                  const text = isRecommended ? `${value} (권장)` : value

                  return (
                    <Button
                      key={`q${i}o${j}`}
                      autoFocus={i === 0 && j === 0 ? true : undefined}
                      variant={given === value ? 'primary' : 'secondary'}
                      onPress={() => pick($, i, value)}
                    >
                      {isRecommended ? <Text color={RECOMMENDED}>{text}</Text> : text}
                    </Button>
                  )
                })}
                <Button key={`q${i}skip`} label="건너뛰기" dimColor onPress={() => pick($, i, '')} />
              </Box>
              <Box marginLeft={4}>
                <Input
                  key={`other${i}`}
                  label="기타 (직접 입력)"
                  placeholder="your own answer"
                  value={given !== undefined && !isListed ? given : ''}
                  submitLabel="answer"
                  onSubmit={value => pick($, i, value)}
                />
              </Box>
            </Box>
          )
        })}
        {tookText(flow) !== '' ? (
          <Box marginTop={1}>
            <Text dimColor>{tookText(flow)}</Text>
          </Box>
        ) : null}
        <Box flexWrap="wrap" columnGap={1} marginTop={1}>
          {hasRecommended(flow) ? (
            <Button
              label="권장안으로 업그레이드"
              hotkey="r"
              variant="primary"
              onPress={() => upgradeWithRecommended($)}
            />
          ) : null}
          <Button label="나머지 건너뛰고 업그레이드" hotkey="u" onPress={() => upgradeNow($)} />
          {cancelButton}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {stepper}
      {section('YOUR UPGRADED PROMPT', 'revise it, then send')}
      <Box flexDirection="column" borderStyle="round" borderColor="success" paddingX={1}>
        <Markdown text={clip(flow.draft, DRAFT_CLIP)} />
      </Box>
      {tookText(flow) !== '' ? <Text dimColor>{tookText(flow)}</Text> : null}
      {flow.notice !== '' ? (
        <Box marginTop={1}>
          <Text bold color="warning">
            {flow.notice}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Input
          key="revise"
          label="수정"
          placeholder="what should change?"
          submitLabel="revise"
          onSubmit={value => revise($, value)}
        />
      </Box>
      <Box flexWrap="wrap" columnGap={1} marginTop={1}>
        {/* UNVERIFIED: hotkeys fire while the revise Input holds the focus */}
        <Button label="이 프롬프트 보내기" hotkey="s" variant="primary" onPress={() => finishDraft($)} />
        {flow.prevDraft !== '' ? <Button label="수정 되돌리기" hotkey="u" onPress={() => undoRevision($)} /> : null}
        <Button label="입력창에서 편집" hotkey="e" onPress={() => editInPrompt($)} />
        <Button label="원문 그대로 보내기" hotkey="o" onPress={() => finishOriginal($)} />
        {cancelButton}
      </Box>
    </Box>
  )
}

export const COMMAND = 'prompt-upgrade'
export const COMMAND_HELP = 'Show the Prompt Upgrade switches, set its threshold, reset it, or read the PoC probe log'
const PROBE_PANE = 'prompt-upgrade-probe'
export const KEY_MIN_LEN = 'minLen'
const KEY_PROBE = 'probe'
const KEY_LOG = 'probe-log'
const LOG_LIMIT = 30
const PANE_ROWS = 20
const DROP_REASON = 'Prompt Upgrade is working on your prompt.'

type Sample = {
  at: number
  length: number
  origin: string
  attachments: string
  isMidTurn: boolean
  wait: boolean
  surfaces: string
  pane: string
}

const USAGE = [
  `/${COMMAND} status`,
  `/${COMMAND} threshold <characters>`,
  `/${COMMAND} reset`,
  `/${COMMAND} probe on | off | show | clear`,
].join('\n')

const recordProbe = async ($: EngineInterface, e: PromptSubmitInput): Promise<void> => {
  if ((await $.store.get(KEY_PROBE)) !== true) return
  const surfaces = await $.session.surfaces()
  const opened = await $.ui.open({ id: PROBE_PANE, title: 'Probe', focus: true })
  await $.ui.close({ id: PROBE_PANE })
  const sample: Sample = {
    at: await $.clock.now(),
    length: e.text.trim().length,
    origin: JSON.stringify(e.origin),
    attachments: JSON.stringify(e.attachments ?? null),
    isMidTurn: e.turnId !== undefined,
    wait: e.wait,
    surfaces: surfaces.join(','),
    pane: opened.isPlaced ? 'placed' : `waits: ${opened.reason}`,
  }
  const log = ((await $.store.get(KEY_LOG)) as Sample[] | undefined) ?? []
  await $.store.set(KEY_LOG, [...log, sample].slice(-LOG_LIMIT))
}

const readSources = ($: EngineInterface) =>
  Promise.all(SETTINGS_SOURCES.map(async source => [source, await $.settings.read({ source })] as const))

const readFlags = async ($: EngineInterface): Promise<Flags> =>
  flagsOf((await readSources($)).map(([, settings]) => settings))

const settingsOf = async ($: EngineInterface) => {
  const sources = (await readSources($)).map(([, settings]) => settings)
  const flags = flagsOf(sources)

  return {
    isEnabled: flags['use-prompt-upgrade'],
    useQuestions: flags['use-questions'],
    isSilent: flags['use-prompt-upgrade'] && flags['use-silent-upgrade'],
    skipTrigger: flags['skip-silent-trigger'],
    minLen: minLengthOf(sources) ?? parseMinLen(await $.store.get(KEY_MIN_LEN)),
    silentTriggers:
      flags['use-prompt-upgrade'] && flags['use-silent-upgrade'] ? (silentTriggersOf(sources) ?? DEFAULT_SILENT_TRIGGERS) : [],
    offTriggers:
      flags['use-prompt-upgrade'] && flags['use-silent-upgrade'] ? (silentOffTriggersOf(sources) ?? DEFAULT_SILENT_OFF_TRIGGERS) : [],
  }
}

const abandon = async ($: EngineInterface, cause?: unknown): Promise<void> => {
  try {
    if (cause !== undefined) $.ui.log(`Prompt Upgrade passed the prompt through: ${cause instanceof Error ? cause.message : String(cause)}`)
    await setFlow($, reset)
    await $.ui.close({ id: PANE })
  } catch {
    return
  }
}

const readContext = async ($: EngineInterface): Promise<string> => {
  try {
    const messages = await $.session.messages()

    return Array.isArray(messages) ? buildContext(messages) : ''
  } catch {
    return ''
  }
}

const interceptOrPass = async ($: EngineInterface, e: PromptSubmitInput) => {
  const { isEnabled, useQuestions, isSilent, skipTrigger, minLen, silentTriggers, offTriggers } = await settingsOf($)
  const flow = await getFlow($)
  const gate = decideGate({
    text: e.text,
    originKind: e.origin?.kind,
    hasAttachments: (e.attachments?.length ?? 0) > 0,
    hasTurnId: e.turnId !== undefined,
    surfaces: isEnabled ? await $.session.surfaces() : [],
    isEnabled,
    minLen,
    silentTriggers,
    offTriggers,
    isSilent,
    skipTrigger,
    now: await $.clock.now(),
    flow,
  })
  if (gate.intercept && 'off' in gate) return { rewrite: gate.text }
  if (gate.intercept) {
    const context = await readContext($)
    const text = 'silent' in gate ? gate.text : e.text
    const started = await setFlow($, f => begin(f, text, context))
    if ('silent' in gate) {
      startClassify($, started)
      runSilent($, started.runId, e.text, useQuestions).catch(() => undefined)

      return { drop: DROP_REASON }
    }
    // UNVERIFIED: a pane opened from inside prompt.submit is placed at any terminal width
    const opened = await $.ui.open({ id: PANE, title: 'Prompt Upgrade', focus: true, closeOnEscape: true, rows: PANE_ROWS })
    if (!opened.isPlaced) {
      await abandon($)
      return null
    }
    startClassify($, started)
    startAsk($, started.runId, useQuestions).catch(() => undefined)

    // UNVERIFIED: what a dropped prompt leaves in the prompt box and the input history
    return { drop: DROP_REASON }
  }
  if (gate.clearPending || gate.clearSkip) {
    await setFlow($, f => ({
      ...f,
      pending: gate.clearPending ? null : f.pending,
      skipUntil: gate.clearSkip ? 0 : f.skipUntil,
      filled: gate.clearSkip ? '' : (f.filled ?? ''),
    }))
  }

  return null
}

export const registerUpgrade = (on: Parameters<Register>[0]): void => {
  let isChecked = false

  on('prompt.submit', async ($, e, next) => {
    if (!isChecked) {
      isChecked = true
      try {
        await recoverAfterReload($)
      } catch {
        await abandon($)
      }
    }
    try {
      await recordProbe($, e)
    } catch (cause) {
      await abandon($, cause)
    }
    let rewritten: string | null = null
    try {
      const outcome = await interceptOrPass($, e)
      if (outcome?.drop !== undefined) return { drop: outcome.drop }
      rewritten = outcome?.rewrite ?? null
    } catch (cause) {
      await abandon($, cause)
    }

    return next(rewritten === null ? e : { ...e, text: rewritten })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>Prompt Upgrade needs a terminal or desktop surface.</Text>
    }

    return renderPane($, e, await read($, flowAtom))
  })

  on('ui.render', { component: 'Pane', requestId: PROBE_PANE }, async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>probe</Text>
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await onClosedByPerson($)
    if (e.id === PANE && e.origin.kind === 'unload') await onUnloaded($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [word, sub] = e.args.trim().split(/\s+/)
    if (word === 'status' || word === '') {
      const { minLen } = await settingsOf($)
      const probe = (await $.store.get(KEY_PROBE)) === true
      const flow = await getFlow($)
      const flags = describeFlags(await readSources($))
      const used = await callWithSettings($, CALLS.rewrite)
      const typed = await callWithTypeSettings($, CALLS.classify)
      return {
        text: [
          ...flags.map(f => `${labelOf(f.key)}: ${f.value} (${f.from})`),
          `model ${used.model}; effort ${used.effort}.`,
          `type model ${typed.model}; type effort ${typed.effort}.`,
          `threshold ${minLen} characters (default ${MIN_LEN}); phase ${flow.phase}; probe ${probe ? 'on' : 'off'}.`,
        ].join('\n'),
      }
    }
    if (word === 'threshold') {
      const n = Number(sub)
      if (parseMinLen(n) !== n) return { text: 'Give a whole number from 1 to 10000.' }
      await $.store.set(KEY_MIN_LEN, n)
      const fixed = minLengthOf((await readSources($)).map(([, settings]) => settings))
      if (fixed !== undefined) {
        return { text: `Threshold ${n} characters saved, but ccChatTweaks.prompt.prompt-upgrade.min-length (${fixed}) in settings takes precedence.` }
      }
      return { text: `Threshold ${n} characters.` }
    }
    if (word === 'reset') {
      await cancel($)
      return { text: 'Prompt Upgrade flow reset.' }
    }
    if (word === 'probe') {
      if (sub === 'on' || sub === 'off') {
        await $.store.set(KEY_PROBE, sub === 'on')
        return { text: `Probe ${sub}.` }
      }
      if (sub === 'clear') {
        await $.store.delete(KEY_LOG)
        return { text: 'Probe log cleared.' }
      }
      if (sub === 'show') {
        const log = ((await $.store.get(KEY_LOG)) as Sample[] | undefined) ?? []
        if (log.length === 0) return { text: 'Probe log is empty.' }
        return { text: log.map(s => JSON.stringify(s)).join('\n') }
      }
    }

    return { text: USAGE }
  })
}
