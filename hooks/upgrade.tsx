import type {
  EngineInterface,
  ModelEffort,
  PromptSubmitInput,
  Register,
} from 'claude-code'

import { startPrompt } from './band'
import { recount } from './char-count'
import {
  askInput,
  buildContext,
  callLog,
  CLASSIFY_LOG_PREFIX,
  classifyTail,
  decideGate,
  hasHangul,
  MIN_LEN,
  normalizeCompletion,
  parseMinLen,
  parseTypes,
  sourceOf,
  withMeta,
} from './upgrade-logic'
import { CALLS, CLASSIFY_SYSTEM } from './upgrade-prompts'
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
  todoToolsOf,
  CALL_NAMES,
  type CallName,
} from './settings'

const LOG_ROW_MAX = 2000

type Call = { model: string; effort: ModelEffort; maxTokens: number; timeoutMs: number }

type Timed = { text: string | null; ms: number }

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

const classify = async ($: EngineInterface, original: string, context: string): Promise<string[]> => {
  try {
    const used = await callWithSettings($, 'classify')
    const done = await completeWith($, used, CLASSIFY_SYSTEM, askInput(original, context))
    const types = parseTypes(done.text)
    writeLog($, callLog(used, done.ms, classifyTail(done.text === null ? null : types), LOG_ROW_MAX, CLASSIFY_LOG_PREFIX))

    return types
  } catch {
    return []
  }
}

export const COMMAND = 'prompt-upgrade'
export const COMMAND_HELP = 'Show the Prompt Upgrade switches, set its threshold, or read the PoC probe log'
const PROBE_PANE = 'prompt-upgrade-probe'
export const KEY_MIN_LEN = 'minLen'
const KEY_PROBE = 'probe'
const KEY_LOG = 'probe-log'
const LOG_LIMIT = 30

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

const settingsOf = async ($: EngineInterface) => {
  const sources = (await readSources($)).map(([, settings]) => settings)
  const flags = flagsOf(sources)

  return {
    isEnabled: flags['use-prompt-upgrade'],
    skipTrigger: flags['skip-silent-trigger'],
    minLen: minLengthOf(sources) ?? parseMinLen(await $.store.get(KEY_MIN_LEN)),
    silentTriggers: flags['use-prompt-upgrade'] ? (silentTriggersOf(sources) ?? DEFAULT_SILENT_TRIGGERS) : [],
    offTriggers: flags['use-prompt-upgrade'] ? (silentOffTriggersOf(sources) ?? DEFAULT_SILENT_OFF_TRIGGERS) : [],
    todo: todoToolsOf(sources),
  }
}

const abandon = ($: EngineInterface, cause: unknown): void =>
  writeLog($, `Prompt Upgrade passed the prompt through: ${cause instanceof Error ? cause.message : String(cause)}`)

const readContext = async ($: EngineInterface): Promise<string> => {
  try {
    const messages = await $.session.messages()

    return Array.isArray(messages) ? buildContext(messages) : ''
  } catch {
    return ''
  }
}

const interceptOrPass = async ($: EngineInterface, e: PromptSubmitInput): Promise<string | null> => {
  const { isEnabled, skipTrigger, minLen, silentTriggers, offTriggers, todo } = await settingsOf($)
  const gate = decideGate({
    text: e.text,
    originKind: e.origin?.kind,
    isEnabled,
    minLen,
    silentTriggers,
    offTriggers,
    skipTrigger,
  })
  if (!gate.intercept) return null
  if ('off' in gate || !hasHangul(gate.text)) return gate.text

  const types = 'short' in gate ? [] : await classify($, gate.text, await readContext($))

  return withMeta(gate.text, gate.text, types, todo)
}

export const registerUpgrade = (on: Parameters<Register>[0]): void => {
  on('prompt.submit', async ($, e, next) => {
    await startPrompt($, e.origin)

    try {
      await recordProbe($, e)
    } catch (cause) {
      abandon($, cause)
    }
    let rewritten: string | null = null
    try {
      rewritten = await interceptOrPass($, e)
    } catch (cause) {
      abandon($, cause)
    }

    const submitted = await next(rewritten === null ? e : { ...e, text: rewritten })

    await recount($)

    return submitted
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer') return next(e)

    const source = sourceOf(e.props.text)

    return next(source === null ? e : { ...e, props: { ...e.props, text: source } })
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
      const flags = describeFlags(await readSources($))
      const used = await Promise.all(CALL_NAMES.map(async name => [name, await callWithSettings($, name)] as const))
      return {
        text: [
          ...flags.map(f => `${labelOf(f.key)}: ${f.value} (${f.from})`),
          ...used.map(([name, call]) => `${name} model ${call.model}; effort ${call.effort}.`),
          `threshold ${minLen} characters (default ${MIN_LEN}); probe ${probe ? 'on' : 'off'}.`,
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
