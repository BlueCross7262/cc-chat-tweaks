import { expect, test } from 'claude-code/testing'

import type { RunState } from '../types'
import {
  applyRow,
  changeOf,
  closeOpenRun,
  diffCounts,
  EMPTY_RUN_STATE,
  headerText,
  labelOf,
  namesOf,
  recordChange,
  viewOf,
  type AppendedRow,
} from './runs'

const response = (...blocks: unknown[]): AppendedRow => ({ door: 'response', content: blocks })
const use = (id: string, name = 'Read') => ({ type: 'tool_use', id, name })
const text = (value: string) => ({ type: 'text', text: value })

const feed = (rows: AppendedRow[], from: RunState = EMPTY_RUN_STATE): RunState =>
  rows.reduce(applyRow, from)

test('tool calls without a message between them join one run', () => {
  const state = feed([response(use('a')), response(use('b', 'Edit')), response(use('c'))])

  expect(state.runs).toHaveLength(1)
  expect(state.runs[0]?.calls.map(call => call.id)).toEqual(['a', 'b', 'c'])
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
  expect(view.header && headerText(view.header)).toBe('Calling Edit 1 time')
})

test('a lone failed call keeps its ordinary row', () => {
  const state = applyRow(feed([response(use('a'))]), {
    door: 'tool-result',
    content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true }],
  })

  expect(viewOf(state, ['a'])).toEqual({ header: null, showRow: true })
})

test('a call that is in no run stays an ordinary row', () => {
  expect(viewOf(EMPTY_RUN_STATE, ['x'])).toEqual({ header: null, showRow: true })
})

test('a failed call keeps its row and the header moves to the first call that did not fail', () => {
  const state = applyRow(feed([response(use('a'), use('b'), use('c'))]), {
    door: 'tool-result',
    content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true }],
  })

  expect(viewOf(state, ['a'])).toEqual({ header: null, showRow: true })
  expect(viewOf(state, ['b']).header?.count).toBe(2)
  expect(viewOf(state, ['c'])).toEqual({ header: null, showRow: false })
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

test('lists the tools most used first and cuts the list', () => {
  const calls = ['Read', 'Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write'].map((name, index) => ({
    id: String(index),
    name,
  }))

  expect(namesOf(calls)).toBe('Read, Edit, Bash, Grep, …')
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

  expect(textOf(calls)).toBe('Calling Read, Edit 3 times')
  expect(textOf(feed([resultFor('a', 'b', 'c')], calls))).toBe('Calling Read, Edit 3 times')
  expect(textOf(closeOpenRun(feed([resultFor('a', 'b')], calls)))).toBe('Calling Read, Edit 3 times')
  expect(textOf(closeOpenRun(feed([resultFor('a', 'b', 'c')], calls)))).toBe('Called Read, Edit 3 times')
})

test('a text message closes the run so a finished run reads Called', () => {
  const state = feed([
    response(use('a', 'Read'), use('b', 'Read')),
    resultFor('a', 'b'),
    response(text('summary')),
  ])
  const header = viewOf(state, ['a']).header

  expect(header && headerText(header)).toBe('Called Read 2 times')
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

  expect(viewOf(state, ['b']).header).toMatchObject({ added: 2, removed: 4 })
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
