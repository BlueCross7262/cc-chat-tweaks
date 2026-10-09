import type { FlagKey } from './settings'

export type FlagReport = {
  key: FlagKey
  value: boolean
  from: string
}

export type DoctorInput = {
  flags: FlagReport[]
  missing: FlagKey[]
  settingsPath: string
  runs: {
    tracked: number
    pending: boolean
    failed: number
    changes: number
  }
  line: {
    root: string
    sessionId: string
    pointerFound: boolean
    shown: string | null
    debugFile: string
  }
  env: {
    surface: string
    version: string
  }
}

const flag = (report: FlagReport, keyWidth: number): string =>
  `  ${report.key.padEnd(keyWidth)}  ${report.value ? 'on ' : 'off'}  (${report.from})`

const isOn = (input: DoctorInput, key: FlagKey): boolean =>
  input.flags.some(report => report.key === key && report.value)

export const checksOf = (input: DoctorInput): string[] => {
  const checks: string[] = []

  if (input.missing.length > 0) {
    checks.push(
      `[warn] ${input.settingsPath} lacks ${input.missing.length} switch(es): ${input.missing.join(', ')}. Run /tweaks-doctor --apply to add them with their default (false).`,
    )
  }

  if (isOn(input, 'use-tool-fold') && input.runs.tracked === 0) {
    checks.push(
      '[warn] use-tool-fold is on but no tool-call run is tracked yet. Run a tool call, then run this command again. If it stays at 0, the session.append hook is not seeing rows.',
    )
  }

  if (isOn(input, 'use-progress-line') && !input.line.pointerFound) {
    checks.push(
      '[info] No phase-chain state for this session. The progress line stays empty unless a let-me-go-home phase chain runs here.',
    )
  }

  if (isOn(input, 'use-progress-line') && input.line.pointerFound && input.line.shown === null) {
    checks.push('[warn] A chain pointer exists but the progress line is empty. Check the chain state files.')
  }

  if (!input.flags.some(report => report.value)) {
    checks.push(
      '[info] Every feature is off, so the mod draws nothing. Set a use-* switch to true under ccChatTweaks.chat in settings.json to turn it on.',
    )
  }

  if (checks.length === 0) {
    checks.push('[ok] No problem found.')
  }

  checks.push(
    '[info] If the progress line shows twice, update let-me-go-home to 0.0.48 or later. Earlier versions ship their own copy of it.',
  )

  return checks
}

export const formatReport = (input: DoctorInput): string => {
  const width = Math.max(...input.flags.map(report => report.key.length))
  const { runs, line, env } = input

  return [
    'cc-chat-tweaks doctor',
    '',
    'settings (ccChatTweaks.chat)',
    ...input.flags.map(report => flag(report, width)),
    '',
    'tool-call folding',
    `  runs tracked: ${runs.tracked}, pending: ${runs.pending ? 'yes' : 'no'}, failed calls: ${runs.failed}, change records: ${runs.changes}`,
    '',
    'progress line',
    `  project root: ${line.root || '(unknown)'}`,
    `  session id: ${line.sessionId || '(unknown)'}`,
    `  chain pointer: ${line.pointerFound ? 'found' : 'missing'}`,
    `  shown now: ${line.shown ?? '(nothing)'}`,
    `  debug file: ${line.debugFile === '' ? '(off)' : line.debugFile}`,
    '',
    'environment',
    `  surface: ${env.surface}`,
    `  claude code: ${env.version}`,
    '',
    'checks',
    ...checksOf(input).map(check => `  ${check}`),
  ].join('\n')
}
