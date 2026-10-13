import { isFeatureKey, type FlagKey } from './settings'

export type FlagReport = {
  key: FlagKey
  value: boolean
  from: string
}

export type DoctorInput = {
  flags: FlagReport[]
  runs: {
    tracked: number
    pending: boolean
    failed: number
    changes: number
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
  `  ${report.key.padEnd(keyWidth)}  ${report.value ? 'on ' : 'off'}  (${report.from})`

const isOn = (input: DoctorInput, key: FlagKey): boolean =>
  input.flags.some(report => report.key === key && report.value)

export const checksOf = (input: DoctorInput): string[] => {
  const checks: string[] = []

  if (isOn(input, 'use-tool-fold') && input.runs.tracked === 0) {
    checks.push(
      '[warn] use-tool-fold is on but no tool-call run is tracked yet. Run a tool call, then run this command again. If it stays at 0, the session.append hook is not seeing rows.',
    )
  }

  if (!input.flags.some(report => report.value && isFeatureKey(report.key))) {
    checks.push(
      '[info] Every feature is off, so the mod draws nothing. Set a use-* switch to true under ccChatTweaks.chat in settings.json to turn it on.',
    )
  }

  if (checks.length === 0) {
    checks.push('[ok] No problem found.')
  }

  return checks
}

export const formatReport = (input: DoctorInput): string => {
  const width = Math.max(...input.flags.map(report => report.key.length))
  const { runs, upgrade, env } = input

  return [
    'cc-chat-tweaks doctor',
    '',
    'settings (ccChatTweaks.chat)',
    ...input.flags.map(report => flag(report, width)),
    '',
    'tool-call folding',
    `  runs tracked: ${runs.tracked}, pending: ${runs.pending ? 'yes' : 'no'}, failed calls: ${runs.failed}, change records: ${runs.changes}`,
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
