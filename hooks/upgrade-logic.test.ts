import { expect, test } from 'claude-code/testing'

import {
  askInput,
  buildContext,
  decideGate,
  parseTrigger,
  clip,
  MIN_LEN,
  normalizeCompletion,
  parseMinLen,
  formatMs,
  splitMeta,
  callLog,
  CLASSIFY_LOG_PREFIX,
  classifyTail,
  parseTypes,
  sourceOf,
  stripFence,
  withMeta,
  wrapText,
  type GateInput,
} from './upgrade-logic'

const base: GateInput = {
  text: 'please summarise the attached design document for me',
  originKind: 'composer',
  isEnabled: true,
  minLen: MIN_LEN,
  silentTriggers: [],
  offTriggers: [],
  skipTrigger: true,
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

test('passes a slash command or short text', () => {
  expect(gate({ text: '/compact now please' })).toMatchObject({ reason: 'slash' })
  expect(gate({ text: 'short' })).toMatchObject({ reason: 'short' })
})

test('the threshold comes from the setting', () => {
  expect(gate({ minLen: 100 })).toMatchObject({ intercept: false, reason: 'short' })
  expect(gate({ minLen: 5, text: 'sixchr' })).toEqual({ intercept: true, text: 'sixchr' })
})

test('the length check counts graphemes, as the character count label does, after trimming the ends', () => {
  expect(gate({ minLen: 3, text: '😀😀' })).toMatchObject({ intercept: false, reason: 'short' })
  expect(gate({ minLen: 2, text: '👨‍👩‍👧' })).toMatchObject({ intercept: false, reason: 'short' })
  expect(gate({ minLen: 2, text: 'e\u0301' })).toMatchObject({ intercept: false, reason: 'short' })
  expect(gate({ minLen: 3, text: '😀 😀' })).toEqual({ intercept: true, text: '😀 😀' })
  expect(gate({ minLen: 5, text: '  안녕 하  ' })).toMatchObject({ intercept: false, reason: 'short' })
  expect(gate({ minLen: 4, text: '  안녕 하  ' })).toEqual({ intercept: true, text: '안녕 하' })
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

test('strips a code fence around JSON', () => {
  expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  expect(stripFence('{"a":1}')).toBe('{"a":1}')
})

test('formats Haiku time in ms below a second and in seconds above', () => {
  expect(formatMs(840)).toBe('840ms')
  expect(formatMs(2140)).toBe('2.1s')
})

test('normalizes both completion shapes and failures', () => {
  expect(normalizeCompletion('text')).toBe('text')
  expect(normalizeCompletion({ isAnswered: true, text: 'text' })).toBe('text')
  expect(normalizeCompletion({ isAnswered: false, reason: 'aborted' })).toBeNull()
  expect(normalizeCompletion({ isAnswered: true, text: '  ' })).toBeNull()
  expect(normalizeCompletion(undefined)).toBeNull()
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
  '원본 데이터에서 확인이 필요 없을 때까지 충분히 조사한다.',
  '결과나 결론을 첫 줄에 쓴다.',
  '확인한 사실과 추측을 구분해 쓴다.',
  '이미 있는 할일 목록 중 이번 프롬프트와 관련없는 항목은 삭제한다.',
  '여러 단계의 작업이면 할일 목록을 먼저 생성하고 순서대로 진행한다.',
].join('\n')

const RESEARCH_TAIL = [
  '모든 주장에 근거를 붙인다.',
  '근거는 파일 경로와 줄 번호, 실행 결과, 문서 출처 중 하나로 쓴다.',
  '근거가 없는 내용은 추정이라고 표시한다.',
  '기억에 의존한 내용은 추정이라고 표시한다.',
  '근거끼리 충돌하면 충돌한 사실을 그대로 쓴다.',
].join('\n')

const DISCUSS_TAIL = [
  '순서대로 질문하고 질문 전에 쉽게 설명한다.',
  '권장안 하나를 첫 줄에 쓰고 이유를 그 뒤에 쓴다.',
  '권장안을 고른 기준을 밝힌다.',
].join('\n')

const EXECUTE_TAIL = [
  '완료한 작업, 실패한 작업, 하지 않은 작업을 나눠 쓴다.',
  '독립 도구로 완료한 작업을 증명한다.',
].join('\n')

const META_FULL = [
  '너는 프롬프트 엔지니어다.',
  '아래 <source> 는 내가 AI에게 요청하는 내용이다.',
  '<source> 를 이해하고 맥락에 맞게 전문가가 초보자에게 조언하듯 쉽게 프롬프트를 새로 쓴다.',
  '- 요청, 배경, 분석, 목표, 작업 순서, 제약, 출력 형식, 완료 기준 순서로 쓰고 <source> 에 없는 항목은 쓰지 않는다.',
  '- 명사를 동사로 풀어서 쉬운 언어로 쓴다.',
  '쓴 프롬프트를 채팅에 출력한 후 이 대화에서 그 프롬프트대로 응답한다.',
  '이 지시문은 실행 승인이 아니다.',
  '실행할지와 진행 중인 모드를 유지할지는 <source> 만 보고 판단한다.',
  '<hard rule> 의 규칙은 프롬프트를 쓸 때와 응답할 때 모두 지킨다.',
  '진행 중인 모드가 막는 행동은 이 지시문과 <hard rule> 이 시켜도 하지 않는다.',
  '<hard rule> 의 규칙 문장만 쓴 프롬프트에 한 글자도 바꾸지 않고 옮긴다.',
  '쓴 프롬프트에는 <source> 태그와 <hard rule> 태그를 포함하지 않는다.',
].join('\n')

const META_SHORT = [
  '너는 프롬프트 엔지니어다.',
  '아래 <source> 는 내가 AI에게 요청하는 내용이다.',
  '<source> 를 이해하고 맥락에 맞게 전문가가 초보자에게 조언하듯 쉽게 프롬프트를 새로 쓴다.',
  '- 요청, 배경, 분석, 목표, 작업 순서, 제약, 출력 형식, 완료 기준 순서로 쓰고 <source> 에 없는 항목은 쓰지 않는다.',
  '- 명사를 동사로 풀어서 쉬운 언어로 쓴다.',
  '쓴 프롬프트를 채팅에 출력한 후 이 대화에서 그 프롬프트대로 응답한다.',
  '이 지시문은 실행 승인이 아니다.',
  '실행할지와 진행 중인 모드를 유지할지는 <source> 만 보고 판단한다.',
  '쓴 프롬프트에는 <source> 태그를 포함하지 않는다.',
].join('\n')

const RESEARCH_RULES = `${COMMON_TAIL}\n\n${RESEARCH_TAIL}`

const wrapped = (source: string, rules: string) =>
  `${META_FULL}\n\n<hard rule>\n${rules}\n</hard rule>\n\n<source>\n${source}\n</source>`

test('a Korean draft is wrapped with the instruction, the source and the hard rule block', () => {
  expect(withMeta('원인을 찾는다.', '원인을 찾아 줘', ['research'])).toBe(wrapped('원인을 찾는다.', RESEARCH_RULES))
  expect(withMeta('두 안을 비교한다.', '두 안을 비교해 줘', ['discuss'])).toBe(
    wrapped('두 안을 비교한다.', `${COMMON_TAIL}\n\n${DISCUSS_TAIL}\n${QUESTION_TAIL}`),
  )
  expect(withMeta('버그를 고친다.', '버그를 고쳐 줘', ['execute'])).toBe(
    wrapped('버그를 고친다.', `${COMMON_TAIL}\n\n${EXECUTE_TAIL}`),
  )
})

test('sourceOf returns the source of a full wrapper', () => {
  expect(sourceOf(wrapped('원인을 찾는다.', RESEARCH_RULES))).toBe('원인을 찾는다.')
  expect(sourceOf(wrapped('줄 하나.\n줄 둘.', RESEARCH_RULES))).toBe('줄 하나.\n줄 둘.')
})

test('sourceOf returns the source of a short wrapper', () => {
  expect(sourceOf(withMeta('원인을 찾는다.', '원인을 찾아 줘', []))).toBe('원인을 찾는다.')
})

test('sourceOf returns the source of every wrapper wrapText builds', () => {
  for (const types of [[], ['research'], ['discuss'], ['execute'], ['research', 'execute']]) {
    expect(sourceOf(wrapText('본문 한 줄.\n본문 두 줄.', { types }))).toBe('본문 한 줄.\n본문 두 줄.')
  }
})

test('sourceOf returns null for text that is not an intact wrapper', () => {
  const whole = wrapped('원인을 찾는다.', RESEARCH_RULES)
  expect(sourceOf('원인을 찾는다.')).toBeNull()
  expect(sourceOf(whole.replace('너는 프롬프트 엔지니어다.', '너는 개발자다.'))).toBeNull()
  expect(sourceOf(whole.replace('\n</source>', ''))).toBeNull()
  expect(sourceOf(wrapped('', RESEARCH_RULES))).toBeNull()
  expect(sourceOf(`앞 문장.\n${whole}`)).toBeNull()
})

test('the instruction is the twelve lines of the full form and the nine lines of the short form', () => {
  const full = withMeta('원인을 찾는다.', '원인을 찾아 줘', ['research']).split('\n')
  expect(full.slice(0, 12)).toEqual(META_FULL.split('\n'))
  expect(full[12]).toBe('')
  expect(full[13]).toBe('<hard rule>')
  expect(full.at(-4)).toBe('')
  expect(full.at(-3)).toBe('<source>')
  expect(full.at(-2)).toBe('원인을 찾는다.')
  expect(full.at(-1)).toBe('</source>')
  const short = withMeta('원인을 찾는다.', '원인을 찾아 줘', []).split('\n')
  expect(short.slice(0, 9)).toEqual(META_SHORT.split('\n'))
  expect(short[9]).toBe('')
  expect(short[10]).toBe('<source>')
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
    '권장안을 고른 기준을 밝힌다.',
    '각 단계에 파일 경로로 근거를 붙인다.',
    '대화 중에 선택지가 생기면 AskUserQuestion 도구로 권장안과 함께 질문한다.',
    '권장  보기는 선택지 목록의 맨 앞에 둔다.',
  ].join('\n')
  expect(withMeta(draft, '두 안을 비교해 줘', ['discuss'])).toBe(
    wrapped('두 안을 비교한다.\n각 단계에 파일 경로로 근거를 붙인다.', `${COMMON_TAIL}\n\n${DISCUSS_TAIL}\n${QUESTION_TAIL}`),
  )
  expect(withMeta('원인을 찾는다.\n확인한 사실과  추측을 구분해 쓴다.\n결과나 결론을 첫 줄에 쓴다.', '원인을 찾아 줘', ['research'])).toBe(
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
  const draft = '앞 문장.\n\n<hard rule>\n결과나 결론을 첫 줄에 쓴다.\n<hard rule>\n\n뒤 문장.'
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

test('splitMeta puts the body alone in the box and wrapText builds the message withMeta built before', () => {
  const first = splitMeta('원인을 찾는다.', '원인을 찾아 줘', ['research'])
  expect(first.box).toBe('원인을 찾는다.')
  expect(first.wrap).toEqual({ types: ['research'] })
  expect(wrapText(first.box, first.wrap!)).toBe(wrapped('원인을 찾는다.', RESEARCH_RULES))
  const several = splitMeta('원인을 찾고 고친다.', '원인을 찾고 고쳐 줘', ['execute', 'research', 'execute', 'plan'])
  expect(several.wrap).toEqual({ types: ['execute', 'research'] })
  expect(wrapText(several.box, several.wrap!)).toBe(
    wrapped('원인을 찾고 고친다.', `${COMMON_TAIL}\n\n${EXECUTE_TAIL}\n\n${RESEARCH_TAIL}`),
  )
})

test('no instruction line of either wrapper is an order to run', () => {
  for (const types of [[], ['research'], ['discuss'], ['execute']]) {
    const text = wrapText('본문.', { types })
    const head = text.slice(0, text.indexOf('\n\n<source>\n')).split('\n')
    expect(head.filter(line => line.endsWith('실행한다.'))).toEqual([])
    expect(head).toContain('이 지시문은 실행 승인이 아니다.')
  }
})

test('splitMeta keeps a wrap with no type, and wrapText then builds the short instruction and the source only', () => {
  for (const types of [[], ['plan']]) {
    const { box, wrap } = splitMeta('원인을 찾는다.', '원인을 찾아 줘', types)
    expect(box).toBe('원인을 찾는다.')
    expect(wrap).toEqual({ types: [] })
    expect(wrapText(box, wrap!)).toBe(`${META_SHORT}\n\n<source>\n원인을 찾는다.\n</source>`)
  }
})

test('splitMeta drops the repeated rule lines from the box', () => {
  const draft = '두 안을 비교한다.\n결과나 결론을 첫 줄에 쓴다.\n각 단계에 파일 경로로 근거를 붙인다.'
  expect(splitMeta(draft, '두 안을 비교해 줘', ['discuss'])).toEqual({
    box: '두 안을 비교한다.\n각 단계에 파일 경로로 근거를 붙인다.',
    wrap: { types: ['discuss'] },
  })
})

test('splitMeta leaves no wrap for a prompt without hangul and for a draft that names a tag', () => {
  expect(splitMeta('Find the cause.', 'find the cause', ['research'])).toEqual({ box: 'Find the cause.', wrap: null })
  expect(splitMeta('`<hard rule>` 태그는 없어?', '태그가 없는지 알려 줘', ['research'])).toEqual({
    box: `\`<hard rule>\` 태그는 없어?\n\n${RESEARCH_RULES}`,
    wrap: null,
  })
  expect(splitMeta('`<source>` 는 무엇인지 설명한다.', '설명해 줘', [])).toEqual({
    box: '`<source>` 는 무엇인지 설명한다.',
    wrap: null,
  })
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

test('the classify input carries the context only when there is one', () => {
  expect(askInput('make it shorter')).toBe('<prompt>make it shorter</prompt>')
  expect(askInput('make it shorter', 'user: draft the memo')).toBe('<context>user: draft the memo</context><prompt>make it shorter</prompt>')
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
  expect(gate({ ...silent, text: '+++ hi', isEnabled: false })).toMatchObject({ intercept: false, reason: 'disabled' })
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

  expect(callLog(call, 1900, 'ky_jira mcp 고장났어 ?', 2000, CLASSIFY_LOG_PREFIX)).toBe('Prompt classify: sonnet low · 1.9s · ky_jira mcp 고장났어 ?')
  expect(callLog(call, 840, 'fix the login bug', 2000, CLASSIFY_LOG_PREFIX)).toBe('Prompt classify: sonnet low · 840ms · fix the login bug')
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

  expect(callLog(call, 1900, '  line one\n\nline two  \n', 2000, CLASSIFY_LOG_PREFIX)).toBe('Prompt classify: sonnet low · 1.9s · line one line two')
  expect(callLog(call, 1900, 'a\r\nb\rc\t d', 2000, CLASSIFY_LOG_PREFIX)).toBe('Prompt classify: sonnet low · 1.9s · a b c d')
  expect(callLog(call, 1900, 'a\r\nb\n\nc\rd', 2000, CLASSIFY_LOG_PREFIX)).not.toMatch(/[\r\n]/)
})

test('a call log without an original is the call part alone', () => {
  const call = { model: 'sonnet', effort: 'high' }

  expect(callLog(call, 2100, '', 2000, CLASSIFY_LOG_PREFIX)).toBe('Prompt classify: sonnet high · 2.1s')
  expect(callLog(call, 2100, ' \n\t ', 2000, CLASSIFY_LOG_PREFIX)).toBe('Prompt classify: sonnet high · 2.1s')
})

test('the call log is cut so the whole row stays within the limit', () => {
  const call = { model: 'sonnet', effort: 'low' }
  const row = callLog(call, 1900, 'x'.repeat(5000), 2000, CLASSIFY_LOG_PREFIX)

  expect(row.length).toBe(2000)
  expect(row.startsWith('Prompt classify: sonnet low · 1.9s · xxx')).toBe(true)
  expect(row.endsWith('xxx...')).toBe(true)

  const head = 'Prompt classify: sonnet low · 1.9s'

  expect(callLog(call, 1900, 'abcdefghij', head.length + 3 + 6, CLASSIFY_LOG_PREFIX)).toBe(`${head} · abc...`)
  expect(callLog(call, 1900, 'abcdef', head.length + 3 + 6, CLASSIFY_LOG_PREFIX)).toBe(`${head} · abcdef`)
})

const off = { skipTrigger: true, silentTriggers: ['+++'], offTriggers: ['---'] }

test('the off trigger at either end sends the prompt as it is, without the trigger', () => {
  expect(gate({ ...off, text: `${base.text} ---` })).toEqual({ intercept: true, off: true, text: base.text })
  expect(gate({ ...off, text: `--- ${base.text}` })).toEqual({ intercept: true, off: true, text: base.text })
})

test('the off trigger wins over the silent trigger and removes both', () => {
  expect(gate({ ...off, text: `+++ ${base.text} ---` })).toEqual({ intercept: true, off: true, text: base.text })
})

test('the off trigger applies to a short prompt', () => {
  expect(gate({ ...off, minLen: 1000, text: `${base.text} ---` })).toMatchObject({ off: true })
})

test('the off trigger on its own or with a slash command passes', () => {
  expect(gate({ ...off, text: '---' })).toMatchObject({ intercept: false, reason: 'trigger-only' })
  expect(gate({ ...off, text: '--- /clear' })).toMatchObject({ intercept: false, reason: 'slash' })
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
