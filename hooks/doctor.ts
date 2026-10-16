import type { Untimed } from './runs'
import { GROUP_PATHS, isFeatureKey, labelOf, pathText, type ExtraReport, type FlagKey, type IgnoredKey } from './settings'

export type FlagReport = {
  key: FlagKey
  value: boolean
  from: string
}

export type DoctorInput = {
  flags: FlagReport[]
  extras: ExtraReport[]
  ignored: IgnoredKey[]
  runs: {
    tracked: number
    pending: boolean
    failed: number
    changes: number
    times: number
    done: number
    untimed: Untimed
  }
  upgrade: {
    phase: string
    minLen: number
  }
  env: {
    surface: string
    version: string
  }
}

export const versionText = (info: unknown): string => {
  if (typeof info === 'string') {
    return info
  }

  if (typeof info === 'object' && info !== null && 'version' in info) {
    return versionText((info as { version: unknown }).version)
  }

  return info === undefined || info === null ? 'unknown' : JSON.stringify(info)
}

const flag = (report: FlagReport, keyWidth: number): string =>
  `  ${labelOf(report.key).padEnd(keyWidth)}  ${report.value ? 'on ' : 'off'}  (${report.from})`

const extra = (report: ExtraReport, keyWidth: number): string =>
  `  ${labelOf(report.key).padEnd(keyWidth)}  ${JSON.stringify(report.value)}  (${report.from})`

const isOn = (input: DoctorInput, key: FlagKey): boolean =>
  input.flags.some(report => report.key === key && report.value)

export const checksOf = (input: DoctorInput): string[] => {
  const checks: string[] = []

  if (isOn(input, 'use-tool-fold') && input.runs.tracked === 0) {
    checks.push(
      '[warn] chat.tool-fold.use is on but no tool-call run is tracked yet. Run a tool call, then run this command again. If it stays at 0, the session.append hook is not seeing rows.',
    )
  }

  if (!input.flags.some(report => report.value && isFeatureKey(report.key))) {
    checks.push(
      '[info] Every feature is off, so the mod draws nothing. Set a use switch to true in settings.json to turn it on (use under ccChatTweaks.chat.tool-fold, use-edit-summary under ccChatTweaks.chat, use under ccChatTweaks.prompt.prompt-upgrade).',
    )
  }

  for (const { key, from } of input.ignored) {
    const target = key.startsWith('type-') ? `models.classify.${key.slice('type-'.length)}` : `models.<ask|rewrite|revise>.${key}`

    checks.push(`[warn] prompt.prompt-upgrade.${key} in ${from} is ignored. Use prompt.prompt-upgrade.${target}.`)
  }

  if (checks.length === 0) {
    checks.push('[ok] No problem found.')
  }

  return checks
}

const listOf = (names: readonly string[]): string => (names.length === 0 ? 'none' : names.join(', '))

const tallyOf = (perTool: Untimed['perTool']): string =>
  perTool.length === 0
    ? 'none'
    : perTool.map(([label, count]) => `${label} ${count.untimed}/${count.total}`).join(', ')

export const formatReport = (input: DoctorInput): string => {
  const width = Math.max(
    ...input.flags.map(report => labelOf(report.key).length),
    ...input.extras.map(report => labelOf(report.key).length),
  )
  const { runs, upgrade, env } = input

  return [
    'cc-chat-tweaks doctor',
    '',
    `settings (${GROUP_PATHS.map(pathText).join(', ')})`,
    ...input.flags.map(report => flag(report, width)),
    ...input.extras.map(report => extra(report, width)),
    '',
    'tool-call folding',
    `  runs tracked: ${runs.tracked}, pending: ${runs.pending ? 'yes' : 'no'}, failed calls: ${runs.failed}, change records: ${runs.changes}`,
    `  time records: ${runs.times}, done calls: ${runs.done}`,
    `  untimed failed: ${listOf(runs.untimed.failed)}, untimed other: ${listOf(runs.untimed.others)}`,
    `  per tool (untimed/total): ${tallyOf(runs.untimed.perTool)}`,
    '',
    'prompt upgrade',
    `  phase: ${upgrade.phase}, threshold: ${upgrade.minLen} characters`,
    '',
    'environment',
    `  surface: ${env.surface}`,
    `  claude code: ${env.version}`,
    '',
    'checks',
    ...checksOf(input).map(check => `  ${check}`),
  ].join('\n')
}
