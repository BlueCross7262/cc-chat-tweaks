import { expect, test } from 'claude-code/testing'

import {
  allAnswered,
  answer,
  begin,
  decideGate,
  EMPTY_FLOW,
  clip,
  isStale,
  MIN_LEN,
  normalizeCompletion,
  parseMinLen,
  parseQuestions,
  reset,
  revised,
  rewriteInput,
  stripFence,
  undo,
  withDraft,
  withQuestions,
  type GateInput,
} from './logic'

const base: GateInput = {
  text: 'please summarise the attached design document for me',
  originKind: 'composer',
  hasAttachments: false,
  hasTurnId: false,
  surfaces: ['terminal'],
  isEnabled: true,
  minLen: MIN_LEN,
  now: 1000,
  flow: EMPTY_FLOW,
}

const gate = (patch: Partial<GateInput>) => decideGate({ ...base, ...patch })

test('intercepts a long composer prompt on a terminal when enabled', () => {
  expect(gate({})).toEqual({ intercept: true })
})

test('passes while disabled', () => {
  expect(gate({ isEnabled: false })).toMatchObject({ intercept: false, reason: 'disabled' })
})

test('passes every origin except the person at the composer', () => {
  for (const kind of ['plugin', 'peer', 'task-notification', 'scheduled-trigger', 'sdk', 'bridge', 'channel', undefined]) {
    expect(gate({ originKind: kind })).toMatchObject({ intercept: false, reason: 'origin' })
  }
})

test('passes a prompt typed mid-turn, with attachments, a slash command or short text', () => {
  expect(gate({ hasTurnId: true })).toMatchObject({ reason: 'mid-turn' })
  expect(gate({ hasAttachments: true })).toMatchObject({ reason: 'attachments' })
  expect(gate({ text: '/compact now please' })).toMatchObject({ reason: 'slash' })
  expect(gate({ text: 'short' })).toMatchObject({ reason: 'short' })
})

test('the threshold comes from the setting', () => {
  expect(gate({ minLen: 100 })).toMatchObject({ intercept: false, reason: 'short' })
  expect(gate({ minLen: 5, text: 'sixchr' })).toEqual({ intercept: true })
  expect(parseMinLen(undefined)).toBe(MIN_LEN)
  expect(parseMinLen(0)).toBe(MIN_LEN)
  expect(parseMinLen(2.5)).toBe(MIN_LEN)
  expect(parseMinLen('20')).toBe(MIN_LEN)
  expect(parseMinLen(20)).toBe(20)
})

test('clip shortens long text only', () => {
  expect(clip('abc', 5)).toBe('abc')
  expect(clip('abcdef', 3)).toBe('abc...')
})

test('never intercepts without a terminal surface', () => {
  expect(gate({ surfaces: [] })).toMatchObject({ intercept: false, reason: 'no-terminal' })
  expect(gate({ surfaces: ['vscode'] })).toMatchObject({ intercept: false, reason: 'no-terminal' })
})

test('passes while a flow is running', () => {
  expect(gate({ flow: { ...EMPTY_FLOW, phase: 'questions' } })).toMatchObject({ reason: 'busy' })
})

test('lets the resubmitted text through once and asks to clear it', () => {
  const flow = { ...EMPTY_FLOW, pending: 'final prompt text' }
  expect(gate({ text: '  final prompt text \n', originKind: 'plugin', flow })).toEqual({
    intercept: false,
    reason: 'resubmit',
    clearPending: true,
  })
})

test('the manual-edit pass is spent once and expires', () => {
  const flow = { ...EMPTY_FLOW, skipUntil: 5000 }
  expect(gate({ now: 4000, flow })).toEqual({ intercept: false, reason: 'manual-edit', clearSkip: true })
  expect(gate({ now: 6000, flow })).toEqual({ intercept: true })
})

test('an expired manual-edit pass is cleared even when the prompt passes for another reason', () => {
  const flow = { ...EMPTY_FLOW, skipUntil: 5000 }
  expect(gate({ now: 6000, flow, isEnabled: false })).toEqual({
    intercept: false,
    reason: 'disabled',
    clearSkip: true,
  })
})

test('strips a code fence around JSON', () => {
  expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  expect(stripFence('{"a":1}')).toBe('{"a":1}')
})

test('parses questions, caps them at three and options at five', () => {
  const raw = JSON.stringify({
    questions: [1, 2, 3, 4].map(n => ({ q: `q${n}`, options: ['a', 'b', 'c', 'd', 'e', 'f'] })),
  })
  const qs = parseQuestions('```json\n' + raw + '\n```')
  expect(qs.length).toBe(3)
  expect(qs[0]?.options.length).toBe(5)
})

test('drops malformed questions and returns none on bad input', () => {
  expect(parseQuestions(null)).toEqual([])
  expect(parseQuestions('not json')).toEqual([])
  expect(parseQuestions('{"questions":"x"}')).toEqual([])
  expect(parseQuestions('{"questions":[{"q":"ok","options":["only"]},{"q":"","options":["a","b"]}]}')).toEqual([])
  expect(parseQuestions('{"questions":[]}')).toEqual([])
})

test('normalizes both completion shapes and failures', () => {
  expect(normalizeCompletion('text')).toBe('text')
  expect(normalizeCompletion({ isAnswered: true, text: 'text' })).toBe('text')
  expect(normalizeCompletion({ isAnswered: false, reason: 'aborted' })).toBeNull()
  expect(normalizeCompletion({ isAnswered: true, text: '  ' })).toBeNull()
  expect(normalizeCompletion(undefined)).toBeNull()
})

test('a new run id makes an older response stale', () => {
  const first = begin(EMPTY_FLOW, 'original prompt text')
  const id = first.runId
  expect(isStale(first, id)).toBe(false)
  const next = reset(first)
  expect(isStale(next, id)).toBe(true)
})

test('begin and reset keep the resubmit and manual-edit bookkeeping', () => {
  const flow = { ...EMPTY_FLOW, pending: 'p', skipUntil: 9, runId: 4 }
  expect(begin(flow, 'x').pending).toBe('p')
  expect(reset(flow).skipUntil).toBe(9)
  expect(reset(flow).runId).toBe(5)
})

test('no questions goes straight to the rewrite', () => {
  const f = withQuestions(begin(EMPTY_FLOW, 'orig'), [])
  expect(f.phase).toBe('rewriteLoading')
})

test('answers count, clear on empty and complete when all are given', () => {
  let f = withQuestions(begin(EMPTY_FLOW, 'orig'), [
    { q: 'one', options: ['a', 'b'] },
    { q: 'two', options: ['c', 'd'] },
  ])
  expect(f.phase).toBe('questions')
  f = answer(f, 0, 'a')
  expect(allAnswered(f)).toBe(false)
  f = answer(f, 1, 'd')
  expect(allAnswered(f)).toBe(true)
  f = answer(f, 1, '  ')
  expect(allAnswered(f)).toBe(false)
})

test('the rewrite input lists only the answered questions', () => {
  let f = withQuestions(begin(EMPTY_FLOW, 'orig'), [
    { q: 'one', options: ['a', 'b'] },
    { q: 'two', options: ['c', 'd'] },
  ])
  f = answer(f, 1, 'd')
  expect(rewriteInput(f)).toBe('<prompt>orig</prompt><answers>Q: two\nA: d</answers>')
})

test('revise keeps one level of undo', () => {
  let f = withDraft(begin(EMPTY_FLOW, 'orig'), 'draft one')
  expect(f.phase).toBe('review')
  f = revised(f, 'draft two')
  expect(f.draft).toBe('draft two')
  f = undo(f)
  expect(f.draft).toBe('draft one')
  expect(undo(f).draft).toBe('draft one')
})
