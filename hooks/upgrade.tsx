import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  ModelEffort,
  PromptSubmitInput,
  Register,
} from 'claude-code'

import type { Flow } from '../types'
import {
  answerLogs,
  ASK_LOG_PREFIX,
  callLog,
  CLASSIFY_LOG_PREFIX,
  REWRITE_LOG_PREFIX,
  classifyTail,
  parseTypes,
  askInput,
  begin,
  buildContext,
  decideGate,
  EMPTY_FLOW,
  isStale,
  MIN_LEN,
  normalizeCompletion,
  parseMinLen,
  parseQuestions,
  reset,
  squash,
  rewriteInput,
  SKIP_TTL_MS,
  toPhase,
  withDraft,
  withMeta,
  withQuestions,
  withRecommended,
  unwrapDraft,
} from './upgrade-logic'
import { CALLS, CLASSIFY_SYSTEM, Q_SYSTEM, R_SYSTEM } from './upgrade-prompts'
import {
  DEFAULT_SILENT_OFF_TRIGGERS,
  DEFAULT_SILENT_TRIGGERS,
  describeFlags,
  flagsOf,
  labelOf,
  minLengthOf,
  resolveEffort,
  resolveModel,
  SETTINGS_SOURCES,
  silentOffTriggersOf,
  silentTriggersOf,
  CALL_NAMES,
  type CallName,
  type Flags,
} from './settings'

const LEGACY_PANE = 'prompt-upgrade'
const LOG_ROW_MAX = 2000

const flowAtom = atom({ plugin: 'cc-chat-tweaks', key: 'flow' } as const, EMPTY_FLOW)

const FAILED_NOTICE = 'Haiku did not answer. Showing the original prompt.'

type Call = { model: string; effort: ModelEffort; maxTokens: number; timeoutMs: number }

type Timed = { text: string | null; ms: number }

const getFlow = ($: EngineInterface): Promise<Flow> => read($, flowAtom)

const setFlow = async ($: EngineInterface, fn: (f: Flow) => Flow): Promise<Flow> => {
  await update($, flowAtom, fn)

  return getFlow($)
}

const setIf = ($: EngineInterface, id: number, fn: (f: Flow) => Flow): Promise<Flow> =>
  setFlow($, f => (isStale(f, id) ? f : fn(f)))

const callWithSettings = async ($: EngineInterface, name: CallName): Promise<Call> => {
  try {
    const sources = (await readSources($)).map(([, settings]) => settings)

    return { ...CALLS[name], model: resolveModel(sources, name), effort: resolveEffort(sources, name) }
  } catch {
    return CALLS[name]
  }
}

const writeLog = ($: EngineInterface, row: string): void => {
  try {
    $.ui.log(row)
  } catch {
    return
  }
}

const logCall = ($: EngineInterface, call: Call, ms: number, original: string, prefix: string): void =>
  writeLog($, callLog(call, ms, original, LOG_ROW_MAX, prefix))

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
  name: CallName,
  system: string,
  prompt: string,
  logPrefix: string,
): Promise<Timed> => {
  const used = await callWithSettings($, name)
  const done = await completeWith($, used, system, prompt)
  logCall($, used, done.ms, (await getFlow($).catch(() => EMPTY_FLOW)).original, logPrefix)

  return done
}

const classify = async ($: EngineInterface, flow: Flow): Promise<string[]> => {
  try {
    const used = await callWithSettings($, 'classify')
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

const startRewrite = async ($: EngineInterface, id: number): Promise<void> => {
  try {
    const loading = await setIf($, id, cur => toPhase(cur, 'rewriteLoading'))
    if (isStale(loading, id)) return
    const types = await takeTypes(id, loading.types ?? [])
    const f = await setIf($, id, cur => ({ ...cur, types }))
    if (isStale(f, id)) return
    const done = await callModel($, 'rewrite', R_SYSTEM, rewriteInput(f), REWRITE_LOG_PREFIX)
    await setIf($, id, cur =>
      done.text === null
        ? withDraft(cur, cur.original, FAILED_NOTICE)
        : withDraft(cur, withMeta(unwrapDraft(done.text), cur.original, types)),
    )
  } catch {
    await toOriginal($, id, FAILED_NOTICE)
  }
}

const cancel = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  await setFlow($, reset)
  if (f.phase !== 'idle' && f.original !== '') await restoreText($, f.original)
}

const BOX_SETTLE_MS = 300

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
  const asked = await callModel($, 'ask', Q_SYSTEM, askInput(f), ASK_LOG_PREFIX)
  const questions = parseQuestions(asked.text)
  const next = await setIf($, id, cur =>
    withRecommended(withQuestions(cur, questions)),
  )
  if (isStale(next, id)) return
  for (const row of answerLogs(next, LOG_ROW_MAX)) writeLog($, row)
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

const recoverAfterReload = async ($: EngineInterface): Promise<void> => {
  const f = await getFlow($)
  if (f.phase === 'idle') return
  await setFlow($, reset)
  await $.ui.close({ id: LEGACY_PANE })
  if (f.original !== '') $.ui.toast(`Prompt Upgrade reloaded. Your earlier prompt: ${f.original}`)
}

export const COMMAND = 'prompt-upgrade'
export const COMMAND_HELP = 'Show the Prompt Upgrade switches, set its threshold, reset it, or read the PoC probe log'
const PROBE_PANE = 'prompt-upgrade-probe'
export const KEY_MIN_LEN = 'minLen'
const KEY_PROBE = 'probe'
const KEY_LOG = 'probe-log'
const LOG_LIMIT = 30
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
    skipTrigger: flags['skip-silent-trigger'],
    minLen: minLengthOf(sources) ?? parseMinLen(await $.store.get(KEY_MIN_LEN)),
    silentTriggers: flags['use-prompt-upgrade'] ? (silentTriggersOf(sources) ?? DEFAULT_SILENT_TRIGGERS) : [],
    offTriggers: flags['use-prompt-upgrade'] ? (silentOffTriggersOf(sources) ?? DEFAULT_SILENT_OFF_TRIGGERS) : [],
  }
}

const abandon = async ($: EngineInterface, cause?: unknown): Promise<void> => {
  try {
    if (cause !== undefined) $.ui.log(`Prompt Upgrade passed the prompt through: ${cause instanceof Error ? cause.message : String(cause)}`)
    await setFlow($, reset)
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
  const { isEnabled, useQuestions, skipTrigger, minLen, silentTriggers, offTriggers } = await settingsOf($)
  const flow = await getFlow($)
  const gate = decideGate({
    text: e.text,
    originKind: e.origin?.kind,
    hasAttachments: (e.attachments?.length ?? 0) > 0,
    isEnabled,
    minLen,
    silentTriggers,
    offTriggers,
    skipTrigger,
    now: await $.clock.now(),
    flow,
  })
  if (gate.intercept && 'off' in gate) return { rewrite: gate.text }
  if (gate.intercept) {
    const context = await readContext($)
    const started = await setFlow($, f => begin(f, gate.text, context))
    startClassify($, started)
    runSilent($, started.runId, e.text, useQuestions).catch(() => undefined)

    // UNVERIFIED: what a dropped prompt leaves in the prompt box and the input history
    return { drop: DROP_REASON }
  }
  if (gate.clearSkip) await setFlow($, f => ({ ...f, skipUntil: 0, filled: '' }))

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

  on('ui.render', { component: 'Pane', requestId: PROBE_PANE }, async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>probe</Text>
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [word, sub] = e.args.trim().split(/\s+/)
    if (word === 'status' || word === '') {
      const { minLen } = await settingsOf($)
      const probe = (await $.store.get(KEY_PROBE)) === true
      const flow = await getFlow($)
      const flags = describeFlags(await readSources($))
      const used = await Promise.all(CALL_NAMES.map(async name => [name, await callWithSettings($, name)] as const))
      return {
        text: [
          ...flags.map(f => `${labelOf(f.key)}: ${f.value} (${f.from})`),
          ...used.map(([name, call]) => `${name} model ${call.model}; effort ${call.effort}.`),
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
