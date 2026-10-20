import { expect, test } from 'claude-code/testing'

import {
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
  parseQuestions,
  reset,
  squash,
  callLog,
  answerLogs,
  ASK_LOG_PREFIX,
  CLASSIFY_LOG_PREFIX,
  REWRITE_LOG_PREFIX,
  classifyTail,
  parseTypes,
  rewriteInput,
  stripFence,
  unwrapDraft,
  withDraft,
  withMeta,
  withQuestions,
  withRecommended,
  type GateInput,
} from './upgrade-logic'

const base: GateInput = {
  text: 'please summarise the attached design document for me',
  originKind: 'composer',
  hasAttachments: false,
  isEnabled: true,
  minLen: MIN_LEN,
  silentTriggers: [],
  offTriggers: [],
  skipTrigger: true,
  now: 1000,
  flow: EMPTY_FLOW,
}

const gate = (patch: Partial<GateInput>) => decideGate({ ...base, ...patch })

test('intercepts a long composer prompt when enabled', () => {
  expect(gate({})).toEqual({ intercept: true, text: base.text })
})

test('passes while disabled', () => {
  expect(gate({ isEnabled: false })).toMatchObject({ intercept: false, reason: 'disabled' })
})

test('passes every origin except the person at the composer', () => {
  for (const kind of ['plugin', 'peer', 'task-notification', 'scheduled-trigger', 'sdk', 'bridge', 'channel', undefined]) {
    expect(gate({ originKind: kind })).toMatchObject({ intercept: false, reason: 'origin' })
  }
})

test('passes a prompt with attachments, a slash command or short text', () => {
  expect(gate({ hasAttachments: true })).toMatchObject({ reason: 'attachments' })
  expect(gate({ text: '/compact now please' })).toMatchObject({ reason: 'slash' })
  expect(gate({ text: 'short' })).toMatchObject({ reason: 'short' })
})

test('the threshold comes from the setting', () => {
  expect(gate({ minLen: 100 })).toMatchObject({ intercept: false, reason: 'short' })
  expect(gate({ minLen: 5, text: 'sixchr' })).toEqual({ intercept: true, text: 'sixchr' })
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

test('passes while a flow is running', () => {
  expect(gate({ flow: { ...EMPTY_FLOW, phase: 'questions' } })).toMatchObject({ reason: 'busy' })
})

test('the manual-edit pass is spent once and expires', () => {
  const flow = { ...EMPTY_FLOW, skipUntil: 5000 }
  expect(gate({ now: 4000, flow })).toEqual({ intercept: false, reason: 'manual-edit', clearSkip: true })
  expect(gate({ now: 6000, flow })).toEqual({ intercept: true, text: base.text })
})

test('a prompt with the trigger is upgraded again while a manual-edit pass is open, and the pass stays', () => {
  const flow = { ...EMPTY_FLOW, skipUntil: 5000 }
  const on = { silentTriggers: ['+++'], now: 4000, flow }

  expect(gate({ ...on, text: base.text + ' +++' })).toEqual({ intercept: true, text: base.text })
  expect(gate({ ...on, text: base.text })).toEqual({ intercept: false, reason: 'manual-edit', clearSkip: true })
  expect(gate({ silentTriggers: [], now: 4000, flow, text: base.text + ' +++' })).toEqual({
    intercept: false,
    reason: 'manual-edit',
    clearSkip: true,
  })
})

test('squash drops every kind of white space and keeps the characters', () => {
  expect(squash(' a b\tc\n\nd\r\ne　f g ')).toBe('abcdefg')
  expect(squash('')).toBe('')
  expect(squash(' \n ')).toBe('')
})

test('a prompt that holds the same characters as the filled draft passes whatever the white space, with no time limit, and clears the pass', () => {
  const draft = 'Fix the login bug.\nShow the cause.'
  const flow = { ...EMPTY_FLOW, skipUntil: 5000, filled: squash(draft) }
  const on = { skipTrigger: true, silentTriggers: ['+++'], flow }

  for (const text of [draft, 'Fix the login bug. Show the cause.', '  Fix the login bug.\n\n\nShow  the cause.  \n', 'Fixthe loginbug.Showthe cause.']) {
    expect(gate({ ...on, now: 4000, text })).toEqual({ intercept: false, reason: 'unchanged-draft', clearSkip: true })
    expect(gate({ ...on, now: 999999, text })).toEqual({ intercept: false, reason: 'unchanged-draft', clearSkip: true })
  }
})

test('an edited draft passes only inside the time limit and a prompt after the time limit is upgraded', () => {
  const flow = { ...EMPTY_FLOW, skipUntil: 5000, filled: squash('Fix the login bug.') }
  const on = { skipTrigger: true, silentTriggers: ['+++'], flow }
  const edited = 'Fix the login bug in the form.'

  expect(gate({ ...on, now: 4000, text: edited })).toEqual({ intercept: false, reason: 'manual-edit', clearSkip: true })
  expect(gate({ ...on, now: 6000, text: edited.padEnd(40, ' x') })).toMatchObject({ intercept: true })
})

test('the trigger on an unchanged draft upgrades it again', () => {
  const flow = { ...EMPTY_FLOW, skipUntil: 5000, filled: squash('Fix the login bug.') }
  const on = { skipTrigger: true, silentTriggers: ['+++'], flow, now: 999999 }

  expect(gate({ ...on, text: 'Fix the login bug. +++' })).toEqual({ intercept: true, text: 'Fix the login bug.' })
})

test('an empty filled value passes nothing, and begin and reset keep it', () => {
  expect(gate({ flow: { ...EMPTY_FLOW, filled: '' }, text: base.text })).toEqual({ intercept: true, text: base.text })
  const flow = { ...EMPTY_FLOW, filled: 'abc', skipUntil: 9 }

  expect(begin(flow, 'x').filled).toBe('abc')
  expect(reset(flow).filled).toBe('abc')
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
  const picked = withRecommended({ ...asked, answers: { '1': 'd' } })
  expect(picked.answers).toEqual({ '0': 'a', '1': 'd' })
})

test('strips the prompt and draft wrapper tags from a Haiku answer and keeps input tags', () => {
  expect(unwrapDraft('<prompt>Do the work.</prompt>')).toBe('Do the work.')
  expect(unwrapDraft('  <draft>\nDo the work.\n</draft>  ')).toBe('Do the work.')
  expect(unwrapDraft('<prompt>Read <input>a < b</input> now.')).toBe('Read <input>a < b</input> now.')
  expect(unwrapDraft('Plain text.')).toBe('Plain text.')
  expect(unwrapDraft('Do <prompt>the</prompt> work.<context>x</context>')).toBe('Do the work.x')
  expect(unwrapDraft('<draft>Read <input><prompt>a</prompt></input> now.</draft>')).toBe(
    'Read <input><prompt>a</prompt></input> now.',
  )
})

test('formats Haiku time in ms below a second and in seconds above', () => {
  expect(formatMs(840)).toBe('840ms')
  expect(formatMs(2140)).toBe('2.1s')
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

test('begin and reset keep the manual-edit bookkeeping', () => {
  const flow = { ...EMPTY_FLOW, skipUntil: 9, runId: 4 }
  expect(begin(flow, 'x').skipUntil).toBe(9)
  expect(reset(flow).skipUntil).toBe(9)
  expect(reset(flow).runId).toBe(5)
})

test('no questions goes straight to the rewrite', () => {
  const f = withQuestions(begin(EMPTY_FLOW, 'orig'), [])
  expect(f.phase).toBe('rewriteLoading')
})

test('the rewrite input lists only the answered questions', () => {
  let f = withQuestions(begin(EMPTY_FLOW, 'orig'), [
    { q: 'one', options: ['a', 'b'] },
    { q: 'two', options: ['c', 'd'] },
  ])
  f = { ...f, answers: { '1': 'd' } }
  expect(rewriteInput(f)).toBe('<prompt>orig</prompt><answers>Q: two\nA: d</answers>')
})

test('the rewrite input carries the prompt types between the context and the prompt only when there are some', () => {
  const f = { ...begin(EMPTY_FLOW, 'orig', 'user: earlier'), types: ['research', 'execute'] }
  expect(rewriteInput(f)).toBe('<context>user: earlier</context><types>research,execute</types><prompt>orig</prompt><answers></answers>')
  expect(rewriteInput({ ...f, types: [] })).not.toContain('<types>')
  expect(rewriteInput({ ...f, types: undefined as unknown as string[] })).not.toContain('<types>')
})

test('the draft loses a types tag the model left in it', () => {
  expect(unwrapDraft('<types>research</types>Find the cause.')).toBe('researchFind the cause.')
  expect(unwrapDraft('Read <input><types>a</types></input> now.')).toBe('Read <input><types>a</types></input> now.')
})

test('prompt types keep known values once each in their order', () => {
  expect(parseTypes('{"types":["execute","research"]}')).toEqual(['execute', 'research'])
  expect(parseTypes('{"types":["research","plan","research",3,"discuss"]}')).toEqual(['research', 'discuss'])
  expect(parseTypes('```json\n{"types":["discuss"]}\n```')).toEqual(['discuss'])
  expect(parseTypes('{"types":[]}')).toEqual([])
})

test('prompt types are empty for no answer, broken JSON or a missing list', () => {
  expect(parseTypes(null)).toEqual([])
  expect(parseTypes('not json')).toEqual([])
  expect(parseTypes('{"types":"research"}')).toEqual([])
  expect(parseTypes('{}')).toEqual([])
  expect(parseTypes('null')).toEqual([])
})

const QUESTION_TAIL = '대화 중에 선택지가 생기면 AskUserQuestion 도구로 나에게 권장안과 함께 질문한다.\n권장 보기는 선택지 목록의 맨 앞에 둔다.'

const COMMON_TAIL = [
  '충분히 조사한다.',
  '결과나 결론을 첫 줄에 쓴다.',
  '확인한 사실과 추측을 구분해 쓴다.',
  '확인하지 못한 내용은 확인하지 못했다고 쓴다.',
  '요청하지 않은 배경 설명을 쓰지 않는다.',
  '이미 있는 할일 목록 중 이번 프롬프트와 관련없는 항목은 삭제한다.',
  '여러 단계의 작업이면 할일 목록을 먼저 생성하고 순서대로 진행한다.',
].join('\n')

const RESEARCH_TAIL = [
  '모든 주장에 근거를 붙인다.',
  '근거는 파일 경로와 줄 번호, 실행 결과, 문서 출처 중 하나로 쓴다.',
  '근거가 없는 내용은 추정이라고 표시한다.',
  '근거끼리 충돌하면 충돌한 사실을 그대로 쓴다.',
].join('\n')

const DISCUSS_TAIL = [
  '권장안 하나를 첫 줄에 쓰고 이유를 그 뒤에 쓴다.',
  '선택지마다 장점과 단점을 한 줄씩 쓴다.',
  '권장안을 고른 기준을 밝힌다.',
].join('\n')

const EXECUTE_TAIL = [
  '완료한 작업, 실패한 작업, 하지 않은 작업을 나눠 쓴다.',
  '바꾼 파일을 경로로 나열한다.',
  '검증 방법과 그 결과를 쓴다.',
  '검증을 실행하지 못했으면 실행하지 못했다고 쓴다.',
].join('\n')

const META_FULL = [
  '너는 프롬프트 엔지니어다.',
  '아래 <source> 는 내가 AI에게 요청하는 내용이다.',
  '<source> 의 요청을 수행하는 프롬프트를 먼저 쓴다.',
  '프롬프트의 작업 부분은 <source> 를 바탕으로 새로 쓴다.',
  '쓴 프롬프트를 채팅에 출력한 후 이 대화에서 그 프롬프트를 실행한다.',
  '<hard rule> 의 규칙은 프롬프트를 쓸 때와 실행할 때 모두 지킨다.',
  '<hard rule> 의 규칙 문장만 쓴 프롬프트에 한 글자도 바꾸지 않고 옮긴다.',
  '쓴 프롬프트에는 <source> 태그와 <hard rule> 태그를 포함하지 않는다.',
].join('\n')

const META_SHORT = [
  '너는 프롬프트 엔지니어다.',
  '아래 <source> 는 내가 AI에게 요청하는 내용이다.',
  '<source> 의 요청을 수행하는 프롬프트를 먼저 쓴다.',
  '프롬프트의 작업 부분은 <source> 를 바탕으로 새로 쓴다.',
  '쓴 프롬프트를 채팅에 출력한 후 이 대화에서 그 프롬프트를 실행한다.',
  '쓴 프롬프트에는 <source> 태그를 포함하지 않는다.',
].join('\n')

const RESEARCH_RULES = `${COMMON_TAIL}\n\n${RESEARCH_TAIL}`

const wrapped = (source: string, rules: string) =>
  `${META_FULL}\n\n<source>\n${source}\n</source>\n\n<hard rule>\n${rules}\n</hard rule>`

test('a Korean draft is wrapped with the instruction, the source and the hard rule block', () => {
  expect(withMeta('원인을 찾는다.', '원인을 찾아 줘', ['research'])).toBe(wrapped('원인을 찾는다.', RESEARCH_RULES))
  expect(withMeta('두 안을 비교한다.', '두 안을 비교해 줘', ['discuss'])).toBe(
    wrapped('두 안을 비교한다.', `${COMMON_TAIL}\n\n${DISCUSS_TAIL}\n${QUESTION_TAIL}`),
  )
  expect(withMeta('버그를 고친다.', '버그를 고쳐 줘', ['execute'])).toBe(
    wrapped('버그를 고친다.', `${COMMON_TAIL}\n\n${EXECUTE_TAIL}`),
  )
})

test('the instruction is the eight lines of the full form and the six lines of the short form', () => {
  const full = withMeta('원인을 찾는다.', '원인을 찾아 줘', ['research']).split('\n')
  expect(full.slice(0, 8)).toEqual(META_FULL.split('\n'))
  expect(full[8]).toBe('')
  expect(full[9]).toBe('<source>')
  const short = withMeta('원인을 찾는다.', '원인을 찾아 줘', []).split('\n')
  expect(short.slice(0, 6)).toEqual(META_SHORT.split('\n'))
  expect(short[6]).toBe('')
  expect(short[7]).toBe('<source>')
})

test('several types put the common lines once and the type lines in the order of the types without repeats', () => {
  expect(withMeta('원인을 찾고 고친다.', '원인을 찾고 고쳐 줘', ['execute', 'research', 'execute'])).toBe(
    wrapped('원인을 찾고 고친다.', `${COMMON_TAIL}\n\n${EXECUTE_TAIL}\n\n${RESEARCH_TAIL}`),
  )
  expect(withMeta('원인을 찾고 비교한다.', '원인을 찾고 비교해 줘', ['research', 'discuss'])).toBe(
    wrapped('원인을 찾고 비교한다.', `${COMMON_TAIL}\n\n${RESEARCH_TAIL}\n\n${DISCUSS_TAIL}\n${QUESTION_TAIL}`),
  )
})

test('a draft without a known type gets the short instruction and the source only', () => {
  const expected = `${META_SHORT}\n\n<source>\n원인을 찾는다.\n</source>`
  expect(withMeta('원인을 찾는다.', '원인을 찾아 줘', [])).toBe(expected)
  expect(withMeta('원인을 찾는다.', '원인을 찾아 줘', ['plan'])).toBe(expected)
})

test('a prompt without hangul is left as the draft, with or without a type', () => {
  expect(withMeta('Find the cause.', 'find the cause', ['research'])).toBe('Find the cause.')
  expect(withMeta('Find the cause.', 'find the cause', [])).toBe('Find the cause.')
  expect(withMeta('Find the cause.\n결과나 결론을 첫 줄에 쓴다.', 'find the cause', ['research'])).toBe(
    'Find the cause.\n결과나 결론을 첫 줄에 쓴다.',
  )
})

test('the lines of the draft that repeat a rule leave the source, even without the word 나에게 or with other white space', () => {
  const draft = [
    '두 안을 비교한다.',
    '결과나 결론을 첫 줄에 쓴다.',
    '선택지마다 장점과 단점을 한 줄씩 쓴다.',
    '각 단계에 파일 경로로 근거를 붙인다.',
    '대화 중에 선택지가 생기면 AskUserQuestion 도구로 권장안과 함께 질문한다.',
    '권장  보기는 선택지 목록의 맨 앞에 둔다.',
  ].join('\n')
  expect(withMeta(draft, '두 안을 비교해 줘', ['discuss'])).toBe(
    wrapped('두 안을 비교한다.\n각 단계에 파일 경로로 근거를 붙인다.', `${COMMON_TAIL}\n\n${DISCUSS_TAIL}\n${QUESTION_TAIL}`),
  )
  expect(withMeta('원인을 찾는다.\n충분히  조사한다.\n결과나 결론을 첫 줄에 쓴다.', '원인을 찾아 줘', ['research'])).toBe(
    wrapped('원인을 찾는다.', RESEARCH_RULES),
  )
})

test('a question line of the draft stays in the source when the types add no question lines', () => {
  const draft = '질문 도구를 고친다.\n대화 중에 선택지가 생기면 AskUserQuestion 도구로 나에게 권장안과 함께 질문한다.'
  expect(withMeta(draft, '질문 도구를 고쳐 줘', ['execute'])).toBe(wrapped(draft, `${COMMON_TAIL}\n\n${EXECUTE_TAIL}`))
})

test('a hand typed hard rule block in the draft leaves no tag line and no empty tag pair', () => {
  const draft = `원인을 찾는다.\n\n<hard rule>\n${RESEARCH_RULES}\n<hard rule>`
  expect(withMeta(draft, '원인을 찾아 줘', ['research'])).toBe(wrapped('원인을 찾는다.', RESEARCH_RULES))
})

test('a tag line and a rule in the middle of the draft leave one blank line between the two parts', () => {
  const draft = '앞 문장.\n\n<hard rule>\n충분히 조사한다.\n<hard rule>\n\n뒤 문장.'
  expect(withMeta(draft, '원인을 찾아 줘', ['research'])).toBe(wrapped('앞 문장.\n\n뒤 문장.', RESEARCH_RULES))
})

test('blank lines inside an input block stay as they are', () => {
  const draft = '자료를 읽는다.\n<input>\n가\n\n\n나\n</input>'
  expect(withMeta(draft, '자료를 읽어 줘', ['research'])).toBe(wrapped(draft, RESEARCH_RULES))
})

test('a draft that names a tag in the middle of a line gets no wrapper and the rules once at the end', () => {
  expect(withMeta('`<hard rule>` 태그는 없어?', '태그가 없는지 알려 줘', ['research'])).toBe(
    `\`<hard rule>\` 태그는 없어?\n\n${RESEARCH_RULES}`,
  )
  expect(withMeta('`<source>` 는 무엇인지 설명한다.', '설명해 줘', [])).toBe('`<source>` 는 무엇인지 설명한다.')
})

test('an assembled message that is upgraded again gets one fresh wrapper', () => {
  const once = withMeta('원인을 찾는다.', '원인을 찾아 줘', ['research'])
  expect(withMeta(once, once, ['research'])).toBe(once)
  const shortOnce = withMeta('원인을 찾는다.', '원인을 찾아 줘', [])
  expect(withMeta(shortOnce, shortOnce, [])).toBe(shortOnce)
})

test('the classify log tail names the types, none for an empty list and failed for no answer', () => {
  expect(classifyTail(['research', 'execute'])).toBe('research, execute')
  expect(classifyTail([])).toBe('none')
  expect(classifyTail(null)).toBe('failed')
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
  expect(askInput(plain)).toBe('<prompt>make it shorter</prompt>')
  expect(rewriteInput(plain)).not.toContain('<context>')
  const withCtx = begin(EMPTY_FLOW, 'make it shorter', 'user: draft the memo')
  expect(askInput(withCtx)).toBe('<context>user: draft the memo</context><prompt>make it shorter</prompt>')
  expect(rewriteInput(withCtx)).toContain('<context>user: draft the memo</context>')
  expect(reset(withCtx).context).toBe('')
})

test('parseTrigger strips the trigger from the start, the end or both and repeats', () => {
  expect(parseTrigger('+++ hello', ['+++'])).toBe('hello')
  expect(parseTrigger('hello +++', ['+++'])).toBe('hello')
  expect(parseTrigger('+++ hello +++', ['+++'])).toBe('hello')
  expect(parseTrigger('+++hello', ['+++'])).toBe('hello')
  expect(parseTrigger('+++ +++ hello', ['+++'])).toBe('hello')
  expect(parseTrigger('+++', ['+++'])).toBe('')
  expect(parseTrigger('++++++', ['+++'])).toBe('')
  expect(parseTrigger('a +++ b', ['+++'])).toBeNull()
  expect(parseTrigger('+++ hello', [''])).toBeNull()
  expect(parseTrigger('+++ hello', [])).toBeNull()
})

test('parseTrigger accepts any trigger of the list, mixed at both edges, and tries the longest first', () => {
  expect(parseTrigger('>> hello', ['+++', '>>'])).toBe('hello')
  expect(parseTrigger('hello +++', ['+++', '>>'])).toBe('hello')
  expect(parseTrigger('>> hello +++', ['+++', '>>'])).toBe('hello')
  expect(parseTrigger('+++ >> +++ hello', ['+++', '>>'])).toBe('hello')
  expect(parseTrigger('+++ hello', ['+', '+++'])).toBe('hello')
  expect(parseTrigger('hello ?? there', ['+++', '>>'])).toBeNull()
})

test('a trigger intercepts with the stripped text and skips the short check', () => {
  const silent = { silentTriggers: ['+++'], minLen: 100 }
  expect(gate({ ...silent, text: '+++ summarise it' })).toEqual({ intercept: true, text: 'summarise it' })
  expect(gate({ ...silent, text: 'summarise it +++' })).toEqual({ intercept: true, text: 'summarise it' })
  expect(gate({ ...silent, text: '+++' })).toMatchObject({ intercept: false, reason: 'trigger-only' })
  expect(gate({ ...silent, text: '+++ /compact now' })).toMatchObject({ intercept: false, reason: 'slash' })
  expect(gate({ ...silent, text: '+++ hi', hasAttachments: true })).toMatchObject({ intercept: false, reason: 'attachments' })
  expect(gate({ ...silent, text: '+++ hi', isEnabled: false })).toMatchObject({ intercept: false, reason: 'disabled' })
  expect(gate({ ...silent, text: '+++ hi', flow: { ...EMPTY_FLOW, phase: 'rewriteLoading' } })).toMatchObject({ intercept: false, reason: 'busy' })
})

test('without skip-silent-trigger only the trigger starts an upgrade, and a prompt without it passes', () => {
  const on = { skipTrigger: false, silentTriggers: ['+++'] }

  expect(gate({ ...on })).toMatchObject({ intercept: false, reason: 'no-trigger' })
  expect(gate({ ...on, text: base.text + ' +++' })).toEqual({ intercept: true, text: base.text })
  expect(gate({ ...on, text: '+++ short' })).toEqual({ intercept: true, text: 'short' })
  expect(gate({ ...on, text: '/compact now please do it' })).toMatchObject({ intercept: false, reason: 'slash' })
  expect(gate({ ...on, originKind: 'peer' })).toMatchObject({ intercept: false, reason: 'origin' })
})

test('skip-silent-trigger upgrades every long prompt and keeps the other checks', () => {
  const on = { skipTrigger: true, silentTriggers: ['+++'] }

  expect(gate({ ...on })).toEqual({ intercept: true, text: base.text })
  expect(gate({ ...on, text: base.text + ' +++' })).toEqual({ intercept: true, text: base.text })
  expect(gate({ ...on, text: 'short' })).toMatchObject({ intercept: false, reason: 'short' })
  expect(gate({ ...on, text: '+++ short' })).toEqual({ intercept: true, text: 'short' })
  expect(gate({ ...on, text: '/compact now please do it' })).toMatchObject({ intercept: false, reason: 'slash' })
  expect(gate({ ...on, originKind: 'peer' })).toMatchObject({ intercept: false, reason: 'origin' })
  expect(gate({ ...on, now: 4000, flow: { ...EMPTY_FLOW, skipUntil: 5000 } })).toMatchObject({ intercept: false, reason: 'manual-edit' })
})

test('any trigger of the list starts the silent upgrade', () => {
  const on = { skipTrigger: false, silentTriggers: ['+++', '>>'] }

  expect(gate({ ...on, text: '>> ' + base.text })).toEqual({ intercept: true, text: base.text })
  expect(gate({ ...on, text: base.text + ' +++' })).toEqual({ intercept: true, text: base.text })
  expect(gate({ ...on, text: base.text + ' ??' })).toMatchObject({ intercept: false, reason: 'no-trigger' })
})

test('an empty trigger list keeps the trigger text ordinary', () => {
  expect(gate({ silentTriggers: [], text: '+++ ' + base.text })).toEqual({ intercept: true, text: '+++ ' + base.text })
  expect(gate({ silentTriggers: ['+++'] })).toEqual({ intercept: true, text: base.text })
  expect(gate({ silentTriggers: [], skipTrigger: false, text: '+++ ' + base.text })).toMatchObject({ intercept: false, reason: 'no-trigger' })
})

test('the call log is one row: model, effort, time and the original prompt', () => {
  const call = { model: 'sonnet', effort: 'low' }

  expect(callLog(call, 1900, 'ky_jira mcp 고장났어 ?', 2000, REWRITE_LOG_PREFIX)).toBe('Prompt rewrite: sonnet low · 1.9s · ky_jira mcp 고장났어 ?')
  expect(callLog(call, 840, 'fix the login bug', 2000, REWRITE_LOG_PREFIX)).toBe('Prompt rewrite: sonnet low · 840ms · fix the login bug')
})

test('the ask and rewrite calls each write a row with their own prefix', () => {
  const call = { model: 'sonnet', effort: 'low' }

  expect(callLog(call, 1900, 'fix the login bug', 2000, ASK_LOG_PREFIX)).toBe('Prompt ask: sonnet low · 1.9s · fix the login bug')
  expect(callLog(call, 1900, 'fix the login bug', 2000, REWRITE_LOG_PREFIX)).toBe('Prompt rewrite: sonnet low · 1.9s · fix the login bug')
})

test('the answer log writes one row for each answered question and skips the unanswered ones', () => {
  const flow = {
    ...EMPTY_FLOW,
    questions: [
      { q: 'Which format?', options: ['bullets', 'table'], recommended: 0 },
      { q: 'How long?', options: ['short', 'long'] },
      { q: 'Which\nlanguage?', options: ['Korean', 'English'], recommended: 0 },
    ],
    answers: { '0': 'bullets', '2': 'Korean' },
  }

  expect(answerLogs(flow, 2000)).toEqual(['Prompt answer: Which format? → bullets', 'Prompt answer: Which language? → Korean'])
})

test('the answer log has no row when no question has an answer, and each row is cut at the limit', () => {
  const flow = { ...EMPTY_FLOW, questions: [{ q: 'Which format?', options: ['bullets', 'table'] }], answers: {} }

  expect(answerLogs(flow, 2000)).toEqual([])
  expect(answerLogs({ ...EMPTY_FLOW, questions: [], answers: {} }, 2000)).toEqual([])

  const cut = answerLogs({ ...flow, answers: { '0': 'x'.repeat(5000) } }, 100)

  expect(cut).toHaveLength(1)
  expect(cut[0]?.length).toBe(100)
  expect(cut[0]?.endsWith('xxx...')).toBe(true)
})

test('the classify log row uses its own prefix and the type list as its tail', () => {
  const call = { model: 'haiku', effort: 'low' }

  expect(callLog(call, 600, classifyTail(['research', 'execute']), 2000, CLASSIFY_LOG_PREFIX)).toBe(
    'Prompt classify: haiku low · 600ms · research, execute',
  )
  expect(callLog(call, 5000, classifyTail(null), 2000, CLASSIFY_LOG_PREFIX)).toBe('Prompt classify: haiku low · 5.0s · failed')
})

test('every run of white space in the original becomes one space and the row holds no line break', () => {
  const call = { model: 'sonnet', effort: 'low' }

  expect(callLog(call, 1900, '  line one\n\nline two  \n', 2000, REWRITE_LOG_PREFIX)).toBe('Prompt rewrite: sonnet low · 1.9s · line one line two')
  expect(callLog(call, 1900, 'a\r\nb\rc\t d', 2000, REWRITE_LOG_PREFIX)).toBe('Prompt rewrite: sonnet low · 1.9s · a b c d')
  expect(callLog(call, 1900, 'a\r\nb\n\nc\rd', 2000, REWRITE_LOG_PREFIX)).not.toMatch(/[\r\n]/)
})

test('a call log without an original is the call part alone', () => {
  const call = { model: 'sonnet', effort: 'high' }

  expect(callLog(call, 2100, '', 2000, REWRITE_LOG_PREFIX)).toBe('Prompt rewrite: sonnet high · 2.1s')
  expect(callLog(call, 2100, ' \n\t ', 2000, REWRITE_LOG_PREFIX)).toBe('Prompt rewrite: sonnet high · 2.1s')
})

test('the call log is cut so the whole row stays within the limit', () => {
  const call = { model: 'sonnet', effort: 'low' }
  const row = callLog(call, 1900, 'x'.repeat(5000), 2000, REWRITE_LOG_PREFIX)

  expect(row.length).toBe(2000)
  expect(row.startsWith('Prompt rewrite: sonnet low · 1.9s · xxx')).toBe(true)
  expect(row.endsWith('xxx...')).toBe(true)

  const head = 'Prompt rewrite: sonnet low · 1.9s'

  expect(callLog(call, 1900, 'abcdefghij', head.length + 3 + 6, REWRITE_LOG_PREFIX)).toBe(`${head} · abc...`)
  expect(callLog(call, 1900, 'abcdef', head.length + 3 + 6, REWRITE_LOG_PREFIX)).toBe(`${head} · abcdef`)
})

const off = { skipTrigger: true, silentTriggers: ['+++'], offTriggers: ['---'] }

test('the off trigger at either end sends the prompt as it is, without the trigger', () => {
  expect(gate({ ...off, text: `${base.text} ---` })).toEqual({ intercept: true, off: true, text: base.text })
  expect(gate({ ...off, text: `--- ${base.text}` })).toEqual({ intercept: true, off: true, text: base.text })
})

test('the off trigger wins over the silent trigger and removes both', () => {
  expect(gate({ ...off, text: `+++ ${base.text} ---` })).toEqual({ intercept: true, off: true, text: base.text })
})

test('the off trigger applies to a short prompt and beats an open manual-edit pass', () => {
  expect(gate({ ...off, minLen: 1000, text: `${base.text} ---` })).toMatchObject({ off: true })
  expect(gate({ ...off, now: 1000, flow: { ...EMPTY_FLOW, skipUntil: 5000 }, text: `${base.text} ---` })).toMatchObject({ off: true })
})

test('the off trigger on its own, with a slash command or with an attachment passes', () => {
  expect(gate({ ...off, text: '---' })).toMatchObject({ intercept: false, reason: 'trigger-only' })
  expect(gate({ ...off, text: '--- /clear' })).toMatchObject({ intercept: false, reason: 'slash' })
  expect(gate({ ...off, hasAttachments: true, text: `${base.text} ---` })).toMatchObject({ intercept: false, reason: 'attachments' })
})

test('a shell command that starts with ! passes on every path, with or without a trigger', () => {
  const shell = 'ls -la /some/long/path to list the files'

  expect(gate({ text: `!${shell}` })).toMatchObject({ intercept: false, reason: 'shell' })
  expect(gate({ ...off, text: `!${shell}` })).toMatchObject({ intercept: false, reason: 'shell' })
  expect(gate({ ...off, text: `+++ !${shell}` })).toMatchObject({ intercept: false, reason: 'shell' })
  expect(gate({ ...off, text: `--- !${shell}` })).toMatchObject({ intercept: false, reason: 'shell' })
  expect(gate({ ...off, text: `${shell} !` })).toMatchObject({ intercept: true })
})

test('a prompt with an @file or @agent mention passes, because the resubmit does not expand it', () => {
  expect(gate({ text: 'please review @src/app.ts and tell me what is wrong' })).toMatchObject({ intercept: false, reason: 'mention' })
  expect(gate({ text: '@reviewer please look at the change set carefully' })).toMatchObject({ intercept: false, reason: 'mention' })
  expect(gate({ text: 'see @C:\\work\\a.ts for the failing case please' })).toMatchObject({ intercept: false, reason: 'mention' })
  expect(gate({ ...off, text: `--- ${base.text} @src/app.ts` })).toMatchObject({ intercept: false, reason: 'mention' })
  expect(gate({ ...off, text: `+++ ${base.text} @src/app.ts` })).toMatchObject({ intercept: false, reason: 'mention' })
  expect(gate({ text: 'mail me at someone@example.com about the design document' })).toMatchObject({ intercept: true })
  expect(gate({ text: 'a lone @ sign in the prompt about the design document' })).toMatchObject({ intercept: true })
})

const PASTE = '<pasted_content id="1926"> PS Z:\\Work> powershell -File run.ps1 FAIL: cannot verify master key </pasted_content id="1926">'

test('a prompt that is only pasted material passes, and one with enough text of its own does not', () => {
  expect(gate({ text: PASTE })).toMatchObject({ intercept: false, reason: 'pasted-only' })
  expect(gate({ text: `why?\n${PASTE}` })).toMatchObject({ intercept: false, reason: 'pasted-only' })
  expect(gate({ ...off, text: PASTE })).toMatchObject({ intercept: false, reason: 'pasted-only' })
  expect(gate({ text: `please find the cause of this failure\n${PASTE}` })).toMatchObject({ intercept: true })
  expect(gate({ ...off, text: `+++ ${PASTE}` })).toMatchObject({ intercept: true })
})

test('with no off trigger the text is ordinary', () => {
  expect(gate({ ...off, offTriggers: [], skipTrigger: false, text: `${base.text} ---` })).toMatchObject({ intercept: false, reason: 'no-trigger' })
})
