import type { Call, Change, Run, RunState, Timing } from '../types'
import { countOutput, type EditOutput } from './edit-counts'
import { DEFAULT_UNFOLDED_TOOLS } from './settings'
import { formatMs } from './upgrade-logic'

export const FOLD_MIN_CALLS = 1

const MAX_RUNS = 60
const MAX_IDS = 400
const TALLY_SHOWN = 4

export const EMPTY_RUN_STATE: RunState = { runs: [], failed: [], done: [], changes: [], times: [] }

export const normalizeState = (state: Partial<RunState> | null | undefined): RunState => {
  if (
    state != null &&
    state.runs !== undefined &&
    state.failed !== undefined &&
    state.done !== undefined &&
    state.changes !== undefined &&
    state.times !== undefined
  ) {
    return state as RunState
  }

  return {
    runs: state?.runs ?? [],
    failed: state?.failed ?? [],
    done: state?.done ?? [],
    changes: state?.changes ?? [],
    times: state?.times ?? [],
  }
}

const linesOf = (text: string): string[] =>
  text === '' ? [] : text.replace(/\n$/, '').split('\n')

export const diffCounts = (before: string, after: string): { added: number; removed: number } => {
  const old = linesOf(before)
  const next = linesOf(after)
  let head = 0

  while (head < old.length && head < next.length && old[head] === next[head]) {
    head += 1
  }

  let tail = 0

  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1
  }

  return { added: next.length - head - tail, removed: old.length - head - tail }
}

const textArg = (args: Record<string, unknown>, key: string): string => {
  const value = args[key]

  return typeof value === 'string' ? value : ''
}

const SERENA_INSERTS = ['insert_after_symbol', 'insert_before_symbol', 'replace_symbol_body']

export const changeOf = (
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): { added: number; removed: number } | null => {
  if ((tool === 'Edit' || tool === 'Write') && typeof result === 'object' && result !== null) {
    return countOutput(result as EditOutput)
  }

  if (!tool.startsWith('mcp__serena__')) {
    return null
  }

  const name = tool.slice('mcp__serena__'.length)

  if (name === 'replace_content') {
    return diffCounts(textArg(args, 'needle'), textArg(args, 'repl'))
  }

  return SERENA_INSERTS.includes(name)
    ? { added: linesOf(textArg(args, 'body')).length, removed: 0 }
    : null
}

export const recordChange = (stored: RunState, change: Change): RunState => {
  const state = normalizeState(stored)

  return { ...state, changes: [...state.changes, change].slice(-MAX_IDS) }
}

export const recordTime = (stored: RunState, timing: Timing): RunState => {
  const state = normalizeState(stored)

  return { ...state, times: [...state.times, timing].slice(-MAX_IDS) }
}

export const timingOf = (
  event: { tool_use_id: string; duration_ms?: number; agent_id?: string },
  end: number,
): Timing | null =>
  event.agent_id === undefined &&
  event.tool_use_id !== '' &&
  Number.isFinite(end) &&
  typeof event.duration_ms === 'number' &&
  Number.isFinite(event.duration_ms) &&
  event.duration_ms >= 0
    ? { id: event.tool_use_id, start: end - event.duration_ms, end }
    : null

const isSpan = (timing: Timing): boolean => Number.isFinite(timing.start) && Number.isFinite(timing.end)

type Block = {
  type?: string
  text?: string
  id?: string
  name?: string
  tool_use_id?: string
  is_error?: boolean
}

export type AppendedRow = {
  door: string
  agentId?: string
  content: unknown
}

export type Header = {
  run: Run
  count: number
  isPending: boolean
  calls: Call[]
  failed: number
  added: number
  removed: number
  ms: number | null
}

export type RowView = {
  header: Header | null
  showRow: boolean
}

const blocksOf = (content: unknown): Block[] =>
  Array.isArray(content)
    ? content.filter((block): block is Block => typeof block === 'object' && block !== null)
    : []

const closeLast = (runs: Run[]): Run[] => {
  const last = runs[runs.length - 1]

  return last !== undefined && !last.isClosed
    ? [...runs.slice(0, -1), { ...last, isClosed: true }]
    : runs
}

const addCall = (runs: Run[], call: Call): Run[] => {
  const last = runs[runs.length - 1]

  return last !== undefined && !last.isClosed
    ? [...runs.slice(0, -1), { ...last, calls: [...last.calls, call] }]
    : [...runs, { id: call.id, calls: [call], isClosed: false }]
}

const withResponse = (state: RunState, blocks: Block[], unfolded: readonly string[]): RunState => {
  let runs = state.runs

  for (const block of blocks) {
    if (block.type === 'tool_use' && unfolded.includes(block.name ?? '')) {
      runs = closeLast(runs)
    } else if (block.type === 'tool_use' && typeof block.id === 'string') {
      runs = addCall(runs, { id: block.id, name: block.name ?? 'tool' })
    } else if (block.type === 'text' && (block.text ?? '').trim() !== '') {
      runs = closeLast(runs)
    }
  }

  return runs === state.runs ? state : { ...state, runs: runs.slice(-MAX_RUNS) }
}

const withResults = (state: RunState, blocks: Block[]): RunState => {
  const results = blocks.filter(
    (block): block is Block & { tool_use_id: string } =>
      block.type === 'tool_result' && typeof block.tool_use_id === 'string',
  )

  if (results.length === 0) {
    return state
  }

  const failedIds = results.filter(block => block.is_error === true).map(block => block.tool_use_id)

  return {
    ...state,
    done: [...state.done, ...results.map(block => block.tool_use_id)].slice(-MAX_IDS),
    failed: [...state.failed, ...failedIds].slice(-MAX_IDS),
  }
}

export const closeOpenRun = (stored: RunState): RunState => {
  const state = normalizeState(stored)
  const runs = closeLast(state.runs)

  return runs === state.runs ? state : { ...state, runs }
}

export const closeRunOnTurnEnd = (stored: RunState, agentId: string | undefined): RunState =>
  agentId === undefined ? closeOpenRun(stored) : stored

const TRACKED_DOORS: readonly string[] = ['prompt', 'response', 'tool-result']

export const isTrackedRow = (row: AppendedRow): boolean =>
  row.agentId === undefined && TRACKED_DOORS.includes(row.door)

export const applyRow = (
  stored: RunState,
  row: AppendedRow,
  unfolded: readonly string[] = DEFAULT_UNFOLDED_TOOLS,
): RunState => {
  const state = normalizeState(stored)

  if (row.agentId !== undefined) {
    return state
  }

  if (row.door === 'prompt') {
    return closeOpenRun(state)
  }

  if (row.door === 'response') {
    return withResponse(state, blocksOf(row.content), unfolded)
  }

  if (row.door === 'tool-result') {
    return withResults(state, blocksOf(row.content))
  }

  return state
}

export const hasPending = (stored: RunState): boolean => {
  const state = normalizeState(stored)
  const last = state.runs[state.runs.length - 1]

  return (
    last !== undefined &&
    (!last.isClosed || last.calls.some(call => !state.done.includes(call.id)))
  )
}

export const SHOW_ROW: RowView = { header: null, showRow: true }

export type RowProps = {
  tool: string
  tool_use_id: string
  output?: unknown
  isErrored: boolean
  isInterrupted: boolean
}

export const isStreamingRow = (
  stored: RunState,
  props: RowProps,
  unfolded: readonly string[] = DEFAULT_UNFOLDED_TOOLS,
): boolean =>
  !unfolded.includes(props.tool) &&
  props.output === undefined &&
  !props.isErrored &&
  !props.isInterrupted &&
  !normalizeState(stored).runs.some(run => run.calls.some(call => call.id === props.tool_use_id))

export const viewOf = (stored: RunState, ids: readonly string[]): RowView => {
  const state = normalizeState(stored)
  const run = state.runs.find(item => item.calls.some(call => call.id === ids[0]))

  if (run === undefined) {
    return SHOW_ROW
  }

  const folded = run.calls

  if (folded.length < FOLD_MIN_CALLS) {
    return SHOW_ROW
  }

  const firstId = folded[0]?.id
  const isPending = !run.isClosed || run.calls.some(call => !state.done.includes(call.id))
  const succeededIds = folded.map(call => call.id).filter(id => !state.failed.includes(id))
  const totals = state.changes
    .filter(change => succeededIds.includes(change.id))
    .reduce(
      (sum, change) => ({ added: sum.added + change.added, removed: sum.removed + change.removed }),
      { added: 0, removed: 0 },
    )
  const timed = new Map(state.times.filter(isSpan).map(timing => [timing.id, timing]))
  const owed = folded.filter(call => !timed.has(call.id) && !state.failed.includes(call.id))
  const spans = folded.flatMap(call => {
    const span = timed.get(call.id)

    return span === undefined ? [] : [span]
  })
  const ms = isPending || owed.length > 0 || spans.length === 0
    ? null
    : Math.max(...spans.map(span => span.end)) - Math.min(...spans.map(span => span.start))
  const header: Header | null =
    firstId !== undefined && ids.includes(firstId)
      ? {
          run,
          count: folded.length,
          isPending,
          calls: folded,
          failed: folded.length - succeededIds.length,
          ...totals,
          ms,
        }
      : null

  return { header, showRow: false }
}

export const labelOf = (name: string): string => {
  const last = name.replace(/^mcp__/, '').split('__').pop()

  return last === undefined || last === '' ? name : last
}

const entriesOf = (calls: readonly Call[]): [string, number][] => {
  const counts = new Map<string, number>()

  for (const call of calls) {
    const label = labelOf(call.name).trim()

    if (label !== '') {
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])
}

export const hasMoreNames = (calls: readonly Call[]): boolean => entriesOf(calls).length > TALLY_SHOWN

export const namesOf = (calls: readonly Call[], hasTail = false): string => {
  const entries = entriesOf(calls)
  const shown = entries
    .slice(0, TALLY_SHOWN)
    .map(([label]) => label)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))

  if (hasMoreNames(calls) && hasTail) {
    return `${shown.join(', ')},`
  }

  const names = hasMoreNames(calls) ? `${shown.join(', ')}, …` : shown.join(', ')

  return names.replace(/[,\s]+$/, '')
}

export const hasChanges = (header: Header): boolean => header.added > 0 || header.removed > 0

export const failedSeparator = (header: Header): string =>
  header.failed > 0 && !headerText(header).endsWith(',') ? ',' : ''

export const headerText = (header: Header): string => {
  const hasTail = header.failed > 0 || hasChanges(header)

  const spent = header.ms === null ? '' : ` in ${formatMs(header.ms)}`

  return `${header.isPending ? 'Calling' : 'Called'} ${header.count} ${header.count === 1 ? 'time' : 'times'}${spent} ${namesOf(header.calls, hasTail)}`
}

export type Untimed = {
  failed: string[]
  others: string[]
  perTool: [string, { untimed: number; total: number }][]
}

const labelsOf = (calls: readonly Call[]): string[] =>
  [...new Set(calls.map(call => labelOf(call.name)))].sort()

export const untimedOf = (stored: RunState): Untimed => {
  const state = normalizeState(stored)
  const timedIds = new Set(state.times.filter(isSpan).map(timing => timing.id))
  const calls = state.runs.flatMap(run => run.calls).filter(call => state.done.includes(call.id))
  const untimed = calls.filter(call => !timedIds.has(call.id))

  return {
    failed: labelsOf(untimed.filter(call => state.failed.includes(call.id))),
    others: labelsOf(untimed.filter(call => !state.failed.includes(call.id))),
    perTool: labelsOf(calls).map(label => [
      label,
      {
        untimed: untimed.filter(call => labelOf(call.name) === label).length,
        total: calls.filter(call => labelOf(call.name) === label).length,
      },
    ]),
  }
}
