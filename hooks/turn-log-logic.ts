export const LOG_FOLDER = 'cc-chat-tweaks/turns'
export const MAX_LOG_BYTES = 4 * 1024 * 1024

const isAbsolute = (path: string): boolean => /^([A-Za-z]:)?[\\/]/.test(path)

const trimEnd = (path: string): string => path.replace(/[\\/]+$/, '')

const resolveDots = (path: string): string => {
  const parts: string[] = []

  for (const part of path.split(/[\\/]/)) {
    if (part === '.') continue

    if (part === '..' && parts.length > 1) {
      parts.pop()
      continue
    }

    parts.push(part)
  }

  return parts.join('/')
}

const joinPath = (base: string, rest: string): string => resolveDots(isAbsolute(rest) ? rest : `${trimEnd(base)}/${rest}`)

export const gitdirOf = (text: string, folder: string): string | null => {
  const path = /^gitdir:(.*)$/m.exec(text)?.[1]?.trim()

  return path ? joinPath(folder, path) : null
}

export const commonDirOf = (gitdir: string, commondir: string | null): string => {
  const path = commondir?.trim()

  return path ? joinPath(gitdir, path) : gitdir
}

export const parentOf = (dir: string): string | null => {
  const path = trimEnd(dir)
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

  if (cut < 0) return null

  const parent = path.slice(0, cut)

  if (parent === '' || /^[A-Za-z]:$/.test(parent)) return `${parent}${path[cut]}`

  return parent
}

export const logPathOf = (dir: string, sessionId: string): string => `${trimEnd(dir)}/${LOG_FOLDER}/${sessionId}.jsonl`

const KST_MS = 9 * 60 * 60 * 1000

export const kstText = (ms: number): string => `${new Date(ms + KST_MS).toISOString().slice(0, -1)}+09:00`

export const costSince = (total: number | null, last: number | null): number | null => {
  if (total === null) return null

  const cost = total - (last ?? 0)

  return cost >= 0 ? cost : null
}

export type FinishedTurn = {
  turnId: string
  agentId?: string | undefined
  reason: string
  durationMs: number
  usage?:
    | {
        model: string
        input_tokens: number
        output_tokens: number
        cache_read_input_tokens: number
        cache_creation_input_tokens: number
      }
    | undefined
}

export type TurnRecordInput = {
  at: number
  sessionId: string
  turn: FinishedTurn
  costUsd: number | null
  sessionCostUsd: number | null
  contextPercent: number | null
  promptTurnId: string | null
}

export const turnRecordOf = ({ at, sessionId, turn, costUsd, sessionCostUsd, contextPercent, promptTurnId }: TurnRecordInput) => ({
  at: kstText(at),
  sessionId,
  turnId: turn.turnId,
  agentId: turn.agentId ?? null,
  reason: turn.reason,
  durationMs: turn.durationMs,
  model: turn.usage?.model ?? null,
  inputTokens: turn.usage?.input_tokens ?? null,
  outputTokens: turn.usage?.output_tokens ?? null,
  cacheReadTokens: turn.usage?.cache_read_input_tokens ?? null,
  cacheCreationTokens: turn.usage?.cache_creation_input_tokens ?? null,
  costUsd,
  sessionCostUsd,
  contextPercent,
  promptTurnId,
})

export type TurnRecord = ReturnType<typeof turnRecordOf>

export const appendLine = (existing: string, record: unknown): string => {
  const head = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`

  return `${head}${JSON.stringify(record)}\n`
}


const isRecord = (value: unknown): value is TurnRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { at?: unknown }).at === 'string'

export const recordsOf = (text: string): TurnRecord[] =>
  text.split('\n').flatMap(line => {
    try {
      const value: unknown = JSON.parse(line)

      return isRecord(value) ? [value] : []
    } catch {
      return []
    }
  })

const DASH = '—'

const countText = (value: number | null): string => (value === null ? DASH : String(value))

const secondsText = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

const costText = (usd: number): string => `$${usd.toFixed(4)}`

const sumOf = (records: readonly TurnRecord[], pick: (record: TurnRecord) => number | null): number =>
  records.reduce((total, record) => total + (pick(record) ?? 0), 0)

const sumOrNull = (records: readonly TurnRecord[], pick: (record: TurnRecord) => number | null): number | null =>
  records.every(record => pick(record) === null) ? null : sumOf(records, pick)

const rowOf = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`

const groupsOf = (records: readonly TurnRecord[]): TurnRecord[][] => {
  const groups: TurnRecord[][] = []
  const byKey = new Map<string, TurnRecord[]>()

  for (const record of records) {
    const key = record.promptTurnId ?? null
    const group = key === null ? undefined : byKey.get(key)

    if (group !== undefined) {
      group.push(record)
      continue
    }

    const fresh = [record]
    groups.push(fresh)

    if (key !== null) byKey.set(key, fresh)
  }

  return groups
}

const timeOf = (group: readonly TurnRecord[]): number => {
  const main = group.filter(record => record.agentId === null)

  return sumOf(main.length > 0 ? main : group, record => record.durationMs)
}

export const turnLogText = (path: string, records: readonly TurnRecord[]): string => {
  const head = `Turn log: ${path}`

  if (records.length === 0) return `${head}\n\nNo turns yet.`

  const groups = groupsOf(records)
  const rows = groups.map((group, index) => {
    const read = sumOrNull(group, record => record.cacheReadTokens)
    const write = sumOrNull(group, record => record.cacheCreationTokens)
    const cost = sumOrNull(group, record => record.costUsd)

    return rowOf([
      String(index + 1),
      (group[0]?.at ?? '').slice(11, 19),
      secondsText(timeOf(group)),
      countText(sumOrNull(group, record => record.inputTokens)),
      countText(sumOrNull(group, record => record.outputTokens)),
      read === null && write === null ? DASH : `${countText(read)}/${countText(write)}`,
      cost === null ? DASH : costText(cost),
      String(group.length),
    ])
  })
  const total = `| total | | ${[
    secondsText(groups.reduce((sum, group) => sum + timeOf(group), 0)),
    String(sumOf(records, record => record.inputTokens)),
    String(sumOf(records, record => record.outputTokens)),
    `${sumOf(records, record => record.cacheReadTokens)}/${sumOf(records, record => record.cacheCreationTokens)}`,
    costText(sumOf(records, record => record.costUsd)),
    String(records.length),
  ].join(' | ')} |`

  return [head, '', rowOf(['#', 'at', 'time', 'in', 'out', 'cache r/w', 'cost', 'runs']), '|---|---|---|---|---|---|---|---|', ...rows, total].join('\n')
}
