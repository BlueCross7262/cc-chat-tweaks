import { expect, test } from 'claude-code/testing'

import {
  allAnswered,
  answer,
  askInput,
  begin,
  buildContext,
  decideGate,
  parseTrigger,
  EMPTY_FLOW,
  clip,
  isStale,
  MIN_LEN,
  normalizeCompletion,
  parseMinLen,
  formatMs,
  hasRecommended,
  parseQuestions,
  reset,
  tookText,
  withTook,
  revised,
  rewriteInput,
  stripFence,
  undo,
  unwrapDraft,
  withDraft,
  withQuestions,
  withRecommended,
  type GateInput,
} from './upgrade-logic'

const base: GateInput = {
  text: 'please summarise the attached design document for me',
  originKind: 'composer',
  hasAttachments: false,
  hasTurnId: false,
  surfaces: ['terminal'],
  isEnabled: true,
  minLen: MIN_LEN,
  silentTrigger: '',
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

test('moves the recommended option to the front, counting only the options that survive', () => {
  const raw = JSON.stringify({
    questions: [
      { q: 'one', options: ['a', 'b', 'c'], recommended: 1 },
      { q: 'two', options: ['', 'x', 'y'], recommended: 2 },
      { q: 'three', options: ['p', 'q'], recommended: 5 },
      { q: 'four', options: ['m', 'n'] },
    ],
  })
  const qs = parseQuestions(raw)
  expect(qs[0]?.options).toEqual(['b', 'a', 'c'])
  expect(qs[0]?.recommended).toBe(0)
  expect(qs[1]?.options).toEqual(['y', 'x'])
  expect(qs[1]?.recommended).toBe(0)
  expect(qs[2] && 'recommended' in qs[2]).toBe(false)
})

test('recommended answers fill only the questions that are still open', () => {
  const asked = withQuestions(EMPTY_FLOW, [
    { q: 'one', options: ['a', 'b'], recommended: 0 },
    { q: 'two', options: ['c', 'd'], recommended: 0 },
    { q: 'three', options: ['e', 'f'] },
  ])
  expect(hasRecommended(asked)).toBe(true)
  expect(hasRecommended(withQuestions(EMPTY_FLOW, [{ q: 'x', options: ['a', 'b'] }]))).toBe(false)
  const picked = withRecommended(answer(asked, 1, 'd'))
  expect(picked.answers).toEqual({ '0': 'a', '1': 'd' })
})

test('strips the prompt and draft wrapper tags from a Haiku answer and keeps input tags', () => {
  expect(unwrapDraft('<prompt>Do the work.</prompt>')).toBe('Do the work.')
  expect(unwrapDraft('  <draft>\nDo the work.\n</draft>  ')).toBe('Do the work.')
  expect(unwrapDraft('<prompt>Read <input>a < b</input> now.')).toBe('Read <input>a < b</input> now.')
  expect(unwrapDraft('Plain text.')).toBe('Plain text.')
})

test('formats Haiku time in ms below a second and in seconds above', () => {
  expect(formatMs(840)).toBe('840ms')
  expect(formatMs(2140)).toBe('2.1s')
  expect(tookText(EMPTY_FLOW)).toBe('')
  const flow = withTook(withTook(EMPTY_FLOW, 'ask', 2140), 'rewrite', 840)
  expect(tookText(flow)).toBe('Haiku took questions 2.1s · rewrite 840ms')
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

test('context keeps the newest text turns, clipped, oldest dropped first', () => {
  const turns = [
    { role: 'user' as const, text: 'old question' },
    { role: 'assistant' as const, text: '' },
    { role: 'assistant' as const, text: 'x'.repeat(2000) },
    { role: 'user' as const, text: 'newest' },
  ]
  const ctx = buildContext(turns)
  expect(ctx).toContain('user: newest')
  expect(ctx).toContain('assistant: ' + 'x'.repeat(100))
  expect(ctx).not.toContain('x'.repeat(1000))
  expect(buildContext([])).toBe('')
  expect(buildContext([{ role: 'user', text: '   ' }])).toBe('')
})

test('context is limited to the last turns and a total size', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, text: `turn-${i} ${'y'.repeat(400)}` }))
  const ctx = buildContext(many)
  expect(ctx).toContain('turn-29')
  expect(ctx).not.toContain('turn-0 ')
  expect(ctx.length).toBeLessThanOrEqual(3200)
})

test('the ask and rewrite inputs carry the context only when there is one', () => {
  const plain = begin(EMPTY_FLOW, 'make it shorter')
  expect(askInput(plain)).toBe('make it shorter')
  expect(rewriteInput(plain)).not.toContain('<context>')
  const withCtx = begin(EMPTY_FLOW, 'make it shorter', 'user: draft the memo')
  expect(askInput(withCtx)).toBe('<context>user: draft the memo</context><prompt>make it shorter</prompt>')
  expect(rewriteInput(withCtx)).toContain('<context>user: draft the memo</context>')
  expect(reset(withCtx).context).toBe('')
})

test('parseTrigger strips the trigger from the start, the end or both and repeats', () => {
  expect(parseTrigger('+++ hello', '+++')).toBe('hello')
  expect(parseTrigger('hello +++', '+++')).toBe('hello')
  expect(parseTrigger('+++ hello +++', '+++')).toBe('hello')
  expect(parseTrigger('+++hello', '+++')).toBe('hello')
  expect(parseTrigger('+++ +++ hello', '+++')).toBe('hello')
  expect(parseTrigger('+++', '+++')).toBe('')
  expect(parseTrigger('++++++', '+++')).toBe('')
  expect(parseTrigger('a +++ b', '+++')).toBeNull()
  expect(parseTrigger('+++ hello', '')).toBeNull()
})

test('a trigger intercepts silently with the stripped text and skips the short and terminal checks', () => {
  const silent = { silentTrigger: '+++', minLen: 100, surfaces: [] as string[] }
  expect(gate({ ...silent, text: '+++ summarise it' })).toEqual({ intercept: true, silent: true, text: 'summarise it' })
  expect(gate({ ...silent, text: 'summarise it +++' })).toEqual({ intercept: true, silent: true, text: 'summarise it' })
  expect(gate({ ...silent, text: '+++' })).toMatchObject({ intercept: false, reason: 'trigger-only' })
  expect(gate({ ...silent, text: '+++ /compact now' })).toMatchObject({ intercept: false, reason: 'slash' })
  expect(gate({ ...silent, text: '+++ hi', hasAttachments: true })).toMatchObject({ intercept: false, reason: 'attachments' })
  expect(gate({ ...silent, text: '+++ hi', isEnabled: false })).toMatchObject({ intercept: false, reason: 'disabled' })
  expect(gate({ ...silent, text: '+++ hi', flow: { ...EMPTY_FLOW, phase: 'rewriteLoading' } })).toMatchObject({ intercept: false, reason: 'busy' })
})

test('an empty trigger keeps the ordinary gate and a long prompt still takes the pane path', () => {
  expect(gate({ silentTrigger: '', text: '+++ ' + base.text })).toEqual({ intercept: true })
  expect(gate({ silentTrigger: '+++' })).toEqual({ intercept: true })
})

test('a resubmitted rewrite that ends with the trigger is not intercepted again', () => {
  const flow = { ...EMPTY_FLOW, pending: 'done +++' }
  expect(gate({ silentTrigger: '+++', text: 'done +++', flow })).toMatchObject({ intercept: false, reason: 'resubmit' })
})
