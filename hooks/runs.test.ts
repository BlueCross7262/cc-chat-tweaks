import { expect, test } from 'claude-code/testing'

import type { RunState } from '../types'
import {
  applyRow,
  changeOf,
  closeOpenRun,
  closeRunOnTurnEnd,
  diffCounts,
  EMPTY_RUN_STATE,
  failedSeparator,
  hasChanges,
  hasMoreNames,
  headerText,
  isStreamingRow,
  labelOf,
  namesOf,
  recordChange,
  recordTime,
  timingOf,
  viewOf,
  type AppendedRow,
  type Header,
  type RowProps,
} from './runs'

const response = (...blocks: unknown[]): AppendedRow => ({ door: 'response', content: blocks })
const use = (id: string, name = 'Read') => ({ type: 'tool_use', id, name })
const text = (value: string) => ({ type: 'text', text: value })

const feed = (rows: AppendedRow[], from: RunState = EMPTY_RUN_STATE, unfolded?: readonly string[]): RunState =>
  rows.reduce((state, row) => applyRow(state, row, unfolded), from)

test('tool calls without a message between them join one run', () => {
  const state = feed([response(use('a')), response(use('b', 'Edit')), response(use('c'))])

  expect(state.runs).toHaveLength(1)
  expect(state.runs[0]?.calls.map(call => call.id)).toEqual(['a', 'b', 'c'])
})

test('AskUserQuestion joins no run and closes the open one', () => {
  const state = feed([response(use('a'), use('q', 'AskUserQuestion'), use('b'))])

  expect(state.runs.map(run => run.calls.map(call => call.id))).toEqual([['a'], ['b']])
  expect(viewOf(state, ['q'])).toEqual({ header: null, showRow: true })
})

test('Skill joins no run and closes the open one', () => {
  const state = feed([response(use('a'), use('s', 'Skill'), use('b'))])

  expect(state.runs.map(run => run.calls.map(call => call.id))).toEqual([['a'], ['b']])
  expect(viewOf(state, ['s'])).toEqual({ header: null, showRow: true })
})

test('Agent joins no run and closes the open one', () => {
  const state = feed([response(use('a'), use('g', 'Agent'), use('b'))])

  expect(state.runs.map(run => run.calls.map(call => call.id))).toEqual([['a'], ['b']])
  expect(viewOf(state, ['g'])).toEqual({ header: null, showRow: true })
})

test('AskUserQuestion alone leaves the runs untouched', () => {
  const state = feed([response(use('q', 'AskUserQuestion'))])

  expect(state).toBe(EMPTY_RUN_STATE)
})

test('a text message closes the run and the next call starts another', () => {
  const state = feed([
    response(use('a'), use('b')),
    response(text('done reading')),
    response(use('c'), use('d')),
  ])

  expect(state.runs.map(run => run.calls.map(call => call.id))).toEqual([['a', 'b'], ['c', 'd']])
})

test('text before the calls of one response starts the run those calls join', () => {
  const state = feed([response(use('a')), response(text('now editing'), use('b'), use('c'))])

  expect(state.runs.map(run => run.calls.map(call => call.id))).toEqual([['a'], ['b', 'c']])
})

test('blank text and thinking do not close a run', () => {
  const state = feed([
    response(use('a')),
    response(text('  \n')),
    response({ type: 'thinking' }),
    response(use('b')),
  ])

  expect(state.runs).toHaveLength(1)
})

test('a new prompt closes the open run', () => {
  const state = feed([response(use('a')), { door: 'prompt', content: [text('next')] }, response(use('b'))])

  expect(state.runs).toHaveLength(2)
})

test('rows from a subagent never touch the runs', () => {
  const state = feed([{ ...response(use('a')), agentId: 'sub1' }])

  expect(state).toBe(EMPTY_RUN_STATE)
})

test('an unrelated row returns the same state object', () => {
  const state = feed([response(use('a'))])

  expect(applyRow(state, { door: 'note', content: [text('x')] })).toBe(state)
  expect(applyRow(state, { door: 'tool-result', content: [text('no result block')] })).toBe(state)
})

test('an errored result is remembered as failed', () => {
  const state = applyRow(feed([response(use('a'), use('b'))]), {
    door: 'tool-result',
    content: [{ type: 'tool_result', tool_use_id: 'b', is_error: true }],
  })

  expect(state.failed).toEqual(['b'])
})

test('a run of two or more calls folds into one header on its first call', () => {
  const state = feed([response(use('a'), use('b', 'Edit'), use('c'))])

  expect(viewOf(state, ['a']).header?.count).toBe(3)
  expect(viewOf(state, ['a']).showRow).toBe(false)
  expect(viewOf(state, ['b'])).toEqual({ header: null, showRow: false })
  expect(viewOf(state, ['c'])).toEqual({ header: null, showRow: false })
})

test('a lone call folds into a header of its own', () => {
  const state = feed([response(use('a', 'Edit'))])
  const view = viewOf(state, ['a'])

  expect(view.showRow).toBe(false)
  expect(view.header && headerText(view.header)).toBe('Calling 1 time Edit')
})

test('a lone failed call folds into a header that counts the failure', () => {
  const state = applyRow(feed([response(use('a'))]), {
    door: 'tool-result',
    content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true }],
  })
  const view = viewOf(state, ['a'])

  expect(view.showRow).toBe(false)
  expect(view.header).toMatchObject({ count: 1, failed: 1 })
})

const rowOf = (id: string, over: Partial<RowProps> = {}): RowProps => ({
  tool: 'Read',
  tool_use_id: id,
  output: undefined,
  isErrored: false,
  isInterrupted: false,
  ...over,
})

test('a row drawn before its response is stored is hidden', () => {
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('a'))).toBe(true)
})

test('a row whose call is already in a run is not hidden', () => {
  expect(isStreamingRow(feed([response(use('a'))]), rowOf('a'))).toBe(false)
})

test('a row with a result, an error or an interrupt is not hidden', () => {
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('a', { output: {} }))).toBe(false)
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('a', { isErrored: true }))).toBe(false)
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('a', { isInterrupted: true }))).toBe(false)
})

test('AskUserQuestion, Skill and Agent rows are never hidden', () => {
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('q', { tool: 'AskUserQuestion' }))).toBe(false)
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('s', { tool: 'Skill' }))).toBe(false)
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('g', { tool: 'Agent' }))).toBe(false)
})

test('the unfolded list decides which tools close a run, and the default is AskUserQuestion, Skill and Agent', () => {
  const rows = [response(use('a'), use('g', 'Agent'), use('c'))]

  expect(feed(rows).runs.map(run => run.calls.map(call => call.id))).toEqual([['a'], ['c']])
  expect(feed(rows, EMPTY_RUN_STATE, []).runs.map(run => run.calls.map(call => call.id))).toEqual([['a', 'g', 'c']])
  expect(feed([response(use('a', 'Read'), use('b', 'Edit'))], EMPTY_RUN_STATE, ['Read']).runs.map(run => run.calls.map(call => call.id))).toEqual([['b']])
  expect(feed([response(use('a', 'Bash'), use('b', 'Edit'))], EMPTY_RUN_STATE, ['Bash']).runs.map(run => run.calls.map(call => call.id))).toEqual([['b']])
})

test('the unfolded list also decides which rows are never hidden while streaming', () => {
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('g', { tool: 'Agent' }), [])).toBe(true)
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('r', { tool: 'Read' }), ['Read'])).toBe(false)
  expect(isStreamingRow(EMPTY_RUN_STATE, rowOf('r', { tool: 'Read' }))).toBe(true)
})

test('a call that is in no run stays an ordinary row', () => {
  expect(viewOf(EMPTY_RUN_STATE, ['x'])).toEqual({ header: null, showRow: true })
})

test('a failed call folds into the group and is counted in the header', () => {
  const state = applyRow(feed([response(use('a'), use('b'), use('c'))]), {
    door: 'tool-result',
    content: [{ type: 'tool_result', tool_use_id: 'b', is_error: true }],
  })

  expect(viewOf(state, ['a']).header).toMatchObject({ count: 3, failed: 1 })
  expect(viewOf(state, ['a']).showRow).toBe(false)
  expect(viewOf(state, ['b'])).toEqual({ header: null, showRow: false })
  expect(viewOf(state, ['c'])).toEqual({ header: null, showRow: false })
})

test('the header stays on the first call when that call failed', () => {
  const state = applyRow(feed([response(use('a'), use('b'))]), {
    door: 'tool-result',
    content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true }],
  })

  expect(viewOf(state, ['a']).header).toMatchObject({ count: 2, failed: 1 })
  expect(viewOf(state, ['a']).showRow).toBe(false)
  expect(viewOf(state, ['b']).header).toBe(null)
})

test('a header without failures counts none', () => {
  expect(viewOf(feed([response(use('a'), use('b'))]), ['a']).header?.failed).toBe(0)
})

test('a group holds the header when it holds the first folded call', () => {
  const state = feed([response(use('a'), use('b'), use('c'))])
  const view = viewOf(state, ['a', 'b'])

  expect(view.header?.run.id).toBe('a')
  expect(view.showRow).toBe(false)
  expect(viewOf(state, ['c'])).toEqual({ header: null, showRow: false })
})

test('keeps only the newest sixty runs', () => {
  const rows = Array.from({ length: 70 }, (_, index) => [
    response(use(`c${index}a`), use(`c${index}b`)),
    response(text('message')),
  ]).flat()

  expect(feed(rows).runs).toHaveLength(60)
})

test('names a tool by the last part of its MCP name', () => {
  expect(labelOf('mcp__serena__replace_content')).toBe('replace_content')
  expect(labelOf('Edit')).toBe('Edit')
})

test('reads a state stored by an older version that lacks the done list', () => {
  const legacy = { runs: [{ id: 'a', calls: [{ id: 'a', name: 'Read' }, { id: 'b', name: 'Edit' }], isClosed: true }], failed: [], unfolded: [] } as unknown as RunState

  expect(viewOf(legacy, ['a']).header?.isPending).toBe(true)
  expect(applyRow(legacy, resultFor('a', 'b')).done).toEqual(['a', 'b'])
  expect(closeOpenRun(legacy).done).toEqual([])
})

test('a subagent turn ending leaves the open main run alone', () => {
  const open = feed([response(use('a'))])
  const afterSubagent = closeRunOnTurnEnd(open, 'p15-impl')
  const state = feed([response(use('b'))], afterSubagent)

  expect(afterSubagent).toBe(open)
  expect(state.runs.map(run => run.calls.map(call => call.id))).toEqual([['a', 'b']])
})

test('a main turn ending closes the open run', () => {
  const state = feed([response(use('b'))], closeRunOnTurnEnd(feed([response(use('a'))]), undefined))

  expect(state.runs.map(run => run.calls.map(call => call.id))).toEqual([['a'], ['b']])
})

test('keeps the most used tools, cuts the list and sorts the names', () => {
  const calls = ['Read', 'Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write'].map((name, index) => ({
    id: String(index),
    name,
  }))

  expect(namesOf(calls)).toBe('Bash, Edit, Grep, Read, …')
})

test('the header knows when the name list is already cut, so the changes need no ellipsis of their own', () => {
  const callsOf = (names: string[]) => names.map((name, index) => ({ id: String(index), name }))
  const many = callsOf(['Read', 'Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write'])
  const few = callsOf(['Read', 'Read', 'Edit', 'Bash'])
  const four = callsOf(['Read', 'Edit', 'Bash', 'Grep'])

  expect(hasMoreNames(many)).toBe(true)
  expect(hasMoreNames(few)).toBe(false)
  expect(hasMoreNames(four)).toBe(false)
  expect(hasMoreNames([])).toBe(false)
  expect(namesOf(many).endsWith('…')).toBe(hasMoreNames(many))
  expect(namesOf(few).endsWith('…')).toBe(hasMoreNames(few))
  expect(namesOf(four).endsWith('…')).toBe(hasMoreNames(four))
})

test('sorts capitalised names first, then lowercase names, each a to z', () => {
  const calls = ['replace_content', 'Read', 'mcp__serena__find_symbol', 'Edit'].map((name, index) => ({
    id: String(index),
    name,
  }))

  expect(namesOf(calls)).toBe('Edit, Read, find_symbol, replace_content')
})

const headerOf = (names: string[], over: Partial<Header> = {}): Header => ({
  run: { id: 'a', calls: [], isClosed: true },
  count: 7,
  isPending: false,
  calls: names.map((name, index) => ({ id: String(index), name })),
  failed: 0,
  added: 0,
  removed: 0,
  ms: null,
  ...over,
})

const MANY = ['Bash', 'Bash', 'Edit', 'Grep', 'Read', 'Glob', 'Write']

test('a cut name list ends with an ellipsis only when nothing follows it', () => {
  expect(headerText(headerOf(MANY))).toBe('Called 7 times Bash, Edit, Grep, Read, …')
  expect(headerText(headerOf(MANY, { failed: 2 }))).toBe('Called 7 times Bash, Edit, Grep, Read,')
  expect(headerText(headerOf(MANY, { added: 13, removed: 5 }))).toBe('Called 7 times Bash, Edit, Grep, Read,')
  expect(headerText(headerOf(MANY, { failed: 2, added: 13 }))).toBe('Called 7 times Bash, Edit, Grep, Read,')
  expect(headerText(headerOf(MANY, { removed: 5 }))).toBe('Called 7 times Bash, Edit, Grep, Read,')
})

test('a name list that is not cut never gets a trailing comma', () => {
  expect(headerText(headerOf(['Edit', 'Read', 'replace_content']))).toBe('Called 7 times Edit, Read, replace_content')
  expect(headerText(headerOf(['Edit', 'Read', 'replace_content'], { failed: 2, added: 13, removed: 5 }))).toBe(
    'Called 7 times Edit, Read, replace_content',
  )
  expect(headerText(headerOf(['Bash', 'Edit', 'Grep', 'Read'], { added: 1 }))).toBe('Called 7 times Bash, Edit, Grep, Read')
})

test('failed is set off from the names by a comma, and a cut list already ends with one', () => {
  const lineOf = (header: Header): string =>
    `${headerText(header)}${failedSeparator(header)}${header.failed > 0 ? ` ${header.failed} failed` : ''}`

  expect(failedSeparator(headerOf(['Edit', 'Read']))).toBe('')
  expect(failedSeparator(headerOf(['Edit', 'Read'], { added: 3 }))).toBe('')
  expect(lineOf(headerOf(['Edit', 'Read', 'replace_content'], { failed: 2 }))).toBe('Called 7 times Edit, Read, replace_content, 2 failed')
  expect(lineOf(headerOf(['Bash', 'Edit', 'Grep', 'Read'], { failed: 1 }))).toBe('Called 7 times Bash, Edit, Grep, Read, 1 failed')
  expect(lineOf(headerOf(MANY, { failed: 2 }))).toBe('Called 7 times Bash, Edit, Grep, Read, 2 failed')
  expect(lineOf(headerOf(MANY, { failed: 2, added: 13 }))).toBe('Called 7 times Bash, Edit, Grep, Read, 2 failed')
  expect(lineOf(headerOf(['Edit'], { failed: 1, isPending: true }))).toBe('Calling 7 times Edit, 1 failed')
  expect(lineOf(headerOf(MANY))).toBe('Called 7 times Bash, Edit, Grep, Read, …')
})

test('the header has changes when lines were added or removed', () => {
  expect(hasChanges(headerOf(['Edit']))).toBe(false)
  expect(hasChanges(headerOf(['Edit'], { added: 1 }))).toBe(true)
  expect(hasChanges(headerOf(['Edit'], { removed: 1 }))).toBe(true)
  expect(hasChanges(headerOf(['Edit'], { failed: 3 }))).toBe(false)
})

test('a trailing comma after the last tool name is dropped', () => {
  const named = (...names: string[]) => names.map((name, index) => ({ id: String(index), name }))

  expect(namesOf(named('Read', 'zed,'))).toBe('Read, zed')
  expect(namesOf(named('Read', 'zed', ' '))).toBe('Read, zed')
  expect(namesOf(named('Read', ''))).toBe('Read')
})

const resultFor = (...ids: string[]): AppendedRow => ({
  door: 'tool-result',
  content: ids.map(id => ({ type: 'tool_result', tool_use_id: id })),
})

test('says Calling while a call has no result and Called once every call has one and the run is closed', () => {
  const calls = feed([response(use('a', 'Read'), use('b', 'Edit'), use('c', 'Read'))])
  const textOf = (state: RunState) => {
    const header = viewOf(state, ['a']).header

    return header && headerText(header)
  }

  expect(textOf(calls)).toBe('Calling 3 times Edit, Read')
  expect(textOf(feed([resultFor('a', 'b', 'c')], calls))).toBe('Calling 3 times Edit, Read')
  expect(textOf(closeOpenRun(feed([resultFor('a', 'b')], calls)))).toBe('Calling 3 times Edit, Read')
  expect(textOf(closeOpenRun(feed([resultFor('a', 'b', 'c')], calls)))).toBe('Called 3 times Edit, Read')
})

test('a text message closes the run so a finished run reads Called', () => {
  const state = feed([
    response(use('a', 'Read'), use('b', 'Read')),
    resultFor('a', 'b'),
    response(text('summary')),
  ])
  const header = viewOf(state, ['a']).header

  expect(header && headerText(header)).toBe('Called 2 times Read')
})

test('the header shows the summed call time right after the count and omits it when there is none', () => {
  expect(headerText(headerOf(['Edit', 'Read'], { count: 3, ms: 3400 }))).toBe('Called 3 times in 3.4s Edit, Read')
  expect(headerText(headerOf(['Edit'], { count: 1, ms: 840 }))).toBe('Called 1 time in 840ms Edit')
  expect(headerText(headerOf(['Edit'], { count: 2, ms: 0 }))).toBe('Called 2 times in 0ms Edit')
  expect(headerText(headerOf(['Edit'], { count: 3, ms: null }))).toBe('Called 3 times Edit')
  expect(headerText(headerOf(['Edit'], { count: 3, ms: 2000, isPending: true }))).toBe('Calling 3 times in 2.0s Edit')
  expect(headerText(headerOf(MANY, { ms: 1200, failed: 2 }))).toBe('Called 7 times in 1.2s Bash, Edit, Grep, Read,')
})

const closedRun = (...ids: string[]): RunState =>
  feed([response(...ids.map(id => use(id))), resultFor(...ids), response(text('done'))])

test('the header time is the sum of every call time of the run', () => {
  const state = recordTime(recordTime(closedRun('a', 'b'), { id: 'a', ms: 1000 }), { id: 'b', ms: 2400 })

  expect(viewOf(state, ['a']).header?.ms).toBe(3400)
})

test('the header has no time while a call is still pending or when one call has no recorded time', () => {
  const open = feed([response(use('a'), use('b')), resultFor('a')])

  expect(viewOf(recordTime(recordTime(open, { id: 'a', ms: 1 }), { id: 'b', ms: 1 }), ['a']).header?.ms).toBeNull()
  expect(viewOf(recordTime(closedRun('a', 'b'), { id: 'a', ms: 1000 }), ['a']).header?.ms).toBeNull()
  expect(viewOf(closedRun('a', 'b'), ['a']).header?.ms).toBeNull()
})

test('a failed call counts in the time, and the later record of one call wins', () => {
  const failed = applyRow(closedRun('a', 'b'), { door: 'tool-result', content: [{ type: 'tool_result', tool_use_id: 'b', is_error: true }] })
  const timed = recordTime(recordTime(recordTime(failed, { id: 'a', ms: 100 }), { id: 'b', ms: 200 }), { id: 'b', ms: 500 })

  expect(viewOf(timed, ['a']).header?.failed).toBe(1)
  expect(viewOf(timed, ['a']).header?.ms).toBe(600)
})

test('recorded times keep the newest 400 and leave the other lists alone', () => {
  const state = Array.from({ length: 450 }, (_, i) => i).reduce(
    (acc, i) => recordTime(acc, { id: `t${i}`, ms: i }),
    EMPTY_RUN_STATE,
  )

  expect(state.times).toHaveLength(400)
  expect(state.times[0]).toEqual({ id: 't50', ms: 50 })
  expect(state.times.at(-1)).toEqual({ id: 't449', ms: 449 })
  expect(state.runs).toEqual([])
})

test('a state stored by an older version without the times list reads as empty and keeps its other lists', () => {
  const legacy = { runs: [], failed: ['x'], done: ['y'], changes: [] } as unknown as RunState

  expect(recordTime(legacy, { id: 'a', ms: 5 })).toEqual({ runs: [], failed: ['x'], done: ['y'], changes: [], times: [{ id: 'a', ms: 5 }] })
  expect(closeOpenRun(legacy).times).toEqual([])
  expect(closeOpenRun(EMPTY_RUN_STATE)).toBe(EMPTY_RUN_STATE)
})

test('a tool event gives a time only for the main thread and only when the engine reports a duration', () => {
  expect(timingOf({ tool_use_id: 'a', duration_ms: 1200 })).toEqual({ id: 'a', ms: 1200 })
  expect(timingOf({ tool_use_id: 'a', duration_ms: 0 })).toEqual({ id: 'a', ms: 0 })
  expect(timingOf({ tool_use_id: 'a', duration_ms: 1200, agent_id: 'sub-1' })).toBeNull()
  expect(timingOf({ tool_use_id: 'a' })).toBeNull()
  expect(timingOf({ tool_use_id: '', duration_ms: 5 })).toBeNull()
  expect(timingOf({ tool_use_id: 'a', duration_ms: -1 })).toBeNull()
  expect(timingOf({ tool_use_id: 'a', duration_ms: Number.NaN })).toBeNull()
})

test('the post tool events reach the time hooks and are passed on without a change', async ($, on) => {
  on('classic.PostToolUse', () => ({}) as never)
  on('classic.PostToolUseFailure', () => ({}) as never)
  const done = await $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 'a', duration_ms: 5 })
  const failed = await $.classic.PostToolUseFailure({ tool_name: 'Read', tool_input: {}, tool_use_id: 'b', error: 'x', duration_ms: 7 })
  const sub = await $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 'c', agent_id: 'sub-1' })

  expect(done).toEqual({})
  expect(failed).toEqual({})
  expect(sub).toEqual({})
})

test('counts only the lines that differ between two texts', () => {
  expect(diffCounts('a\nb\nc', 'a\nB\nd\nc')).toEqual({ added: 2, removed: 1 })
  expect(diffCounts('x', 'x')).toEqual({ added: 0, removed: 0 })
  expect(diffCounts('', 'a\nb')).toEqual({ added: 2, removed: 0 })
  expect(diffCounts('a\nb', '')).toEqual({ added: 0, removed: 2 })
})

test('reads Edit and Write changes from the tool result', () => {
  const patch = [{ lines: [' keep', '-old', '+new a', '+new b'] }]

  expect(changeOf('Edit', {}, { structuredPatch: patch })).toEqual({ added: 2, removed: 1 })
  expect(changeOf('Write', {}, { type: 'create', content: 'a\nb\nc', structuredPatch: [] })).toEqual({
    added: 3,
    removed: 0,
  })
})

test('reads serena edit changes from the call arguments', () => {
  expect(changeOf('mcp__serena__replace_content', { needle: 'a\nb', repl: 'a\nB\nc' }, 'OK')).toEqual({
    added: 2,
    removed: 1,
  })
  expect(changeOf('mcp__serena__insert_after_symbol', { body: 'x\ny\nz\n' }, 'OK')).toEqual({
    added: 3,
    removed: 0,
  })
  expect(changeOf('mcp__serena__find_symbol', {}, 'OK')).toBe(null)
  expect(changeOf('Read', {}, {})).toBe(null)
})

test('sums the changes of the folded calls into the header', () => {
  const calls = feed([response(use('a', 'Edit'), use('b', 'Edit'), use('c', 'Read'))])
  const state = recordChange(recordChange(calls, { id: 'a', added: 3, removed: 1 }), {
    id: 'b',
    added: 2,
    removed: 4,
  })

  expect(viewOf(state, ['a']).header).toMatchObject({ added: 5, removed: 5 })
})

test('a failed call does not add to the header totals', () => {
  const calls = feed([response(use('a', 'Edit'), use('b', 'Edit'), use('c', 'Read'))])
  const state = applyRow(recordChange(recordChange(calls, { id: 'a', added: 3, removed: 1 }), { id: 'b', added: 2, removed: 4 }), {
    door: 'tool-result',
    content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true }],
  })

  expect(viewOf(state, ['a']).header).toMatchObject({ added: 2, removed: 4, failed: 1 })
})

test('a failed result also counts as done', () => {
  const state = applyRow(feed([response(use('a'), use('b'), use('c'))]), {
    door: 'tool-result',
    content: [
      { type: 'tool_result', tool_use_id: 'a', is_error: true },
      { type: 'tool_result', tool_use_id: 'b' },
      { type: 'tool_result', tool_use_id: 'c' },
    ],
  })

  expect(state.done).toEqual(['a', 'b', 'c'])
  expect(state.failed).toEqual(['a'])
})
