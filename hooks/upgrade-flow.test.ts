import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { CLASSIFY_SYSTEM } from './upgrade-prompts'

const LONG = 'please summarise the attached design document for me'
const USAGE = { input_tokens: 1, output_tokens: 1 }
const KOREAN = '첨부한 설계 문서의 내용을 요약해 줄 수 있을까'
const QUESTION_LINE_ONE = '대화 중에 선택지가 생기면 AskUserQuestion 도구로 나에게 권장안과 함께 질문한다.'
const QUESTION_LINE_TWO = '권장 보기는 선택지 목록의 맨 앞에 둔다.'
const EXECUTE_LINE = '완료한 작업, 실패한 작업, 하지 않은 작업을 나눠 쓴다.'

type Setup = {
  entered: string[]
  filled: string[]
  copied: string[]
  others: string[]
  logs: string[]
  classified: { model: string; effort: string; prompt: string }[]
  classifyLogs: string[]
  attachments: unknown[]
}

const world = (
  $: Engine,
  on: On,
  options: { enabled?: boolean; extra?: Record<string, unknown>; types?: string | null; env?: Record<string, string> } = {},
): Setup => {
  const s: Setup = { entered: [], filled: [], copied: [], others: [], logs: [], classified: [], classifyLogs: [], attachments: [] }
  mock.clock(on, { now: 1000 })
  const group = { use: options.enabled ?? true, 'skip-silent-trigger': false, ...options.extra }
  mock.store(on, {})
  const user = { ccChatTweaks: { prompt: { 'prompt-upgrade': group } }, ...(options.env === undefined ? {} : { env: options.env }) }
  on('settings.read', (_$, e) => ({ value: (e as { source?: string }).source === 'user' ? user : {} }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('prompt.fill', (_$, e) => {
    s.filled.push((e as { text: string }).text)
    return { isFilled: true } as never
  })
  on('ui.copy', (_$, e) => {
    s.copied.push((e as { text: string }).text)
    return { value: { isCopied: true } } as never
  })
  on('model.complete', (_$, e) => {
    const call = e as { system?: string; model?: string; effort?: string; prompt?: string }
    if (call.system !== CLASSIFY_SYSTEM) {
      s.others.push(call.system ?? '')
      return { value: { isAnswered: true, text: 'Never used.', usage: USAGE } } as never
    }
    s.classified.push({ model: call.model ?? 'none', effort: call.effort ?? 'none', prompt: call.prompt ?? '' })
    const types = options.types === undefined ? JSON.stringify({ types: [] }) : options.types
    return {
      value: types === null
        ? { isAnswered: false, reason: 'api-error', status: 500, error: 'server_error' }
        : { isAnswered: true, text: types, usage: USAGE },
    } as never
  })
  on('ui.log', (_$, e) => {
    const text = (e as { text: string }).text
    if (text.startsWith('Prompt classify:')) s.classifyLogs.push(text)
    else s.logs.push(text)
    return { value: undefined } as never
  })
  on('prompt.submit', (_$, e) => {
    s.entered.push((e as { text: string }).text)
    s.attachments.push((e as { attachments?: unknown }).attachments)
    return { text: (e as { text: string }).text } as never
  })

  return s
}

const composer = { kind: 'composer' } as const

const submit = ($: Engine, text: string, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, wait: false, origin: composer, ...extra })

const FLOW_META_FULL = [
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

const FLOW_COMMON_RULES = [
  '원본 데이터에서 확인이 필요 없을 때까지 충분히 조사한다.',
  '결과나 결론을 첫 줄에 쓴다.',
  '확인한 사실과 추측을 구분해 쓴다.',
].join('\n')

const FLOW_TODO_RULES = [
  '이미 있는 할일 목록 중 이번 프롬프트와 관련없는 항목은 삭제한다.',
  '여러 단계의 작업이면 할일 목록을 먼저 생성하고 순서대로 진행한다.',
].join('\n')

const FLOW_RESEARCH_RULES = [
  FLOW_COMMON_RULES,
  '',
  '모든 주장에 근거를 붙인다.',
  '근거는 파일 경로와 줄 번호, 실행 결과, 문서 출처 중 하나로 쓴다.',
  '근거가 없는 내용은 추정이라고 표시한다.',
  '기억에 의존한 내용은 추정이라고 표시한다.',
  '근거끼리 충돌하면 충돌한 사실을 그대로 쓴다.',
].join('\n')

const fullWrapped = (rules: string, body: string): string =>
  `${FLOW_META_FULL}\n\n<hard rule>\n${rules}\n</hard rule>\n\n<source>\n${body}\n</source>`
const commonWrapped = (body: string): string => fullWrapped(FLOW_COMMON_RULES, body)

test('nothing is intercepted while disabled', async ($, on) => {
  const s = world($, on, { enabled: false, extra: { 'skip-silent-trigger': true } })
  expect(await submit($, KOREAN)).toMatchObject({ text: KOREAN })
  expect(s.entered).toEqual([KOREAN])
  expect(s.classified).toEqual([])
})

test('a slash command, a shell command and a peer message pass through', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true } })
  expect(await submit($, '/compact the conversation please')).toMatchObject({ text: '/compact the conversation please' })
  expect(await submit($, '!ls -la the current folder now')).toMatchObject({ text: '!ls -la the current folder now' })
  expect(await submit($, KOREAN, { origin: { kind: 'peer' } })).toMatchObject({ text: KOREAN })
  expect(s.classified).toEqual([])
})

test('a Korean prompt with attachments is upgraded and the attachments reach the prompt as they came', async ($, on) => {
  const s = world($, on, { types: JSON.stringify({ types: ['research'] }), extra: { 'skip-silent-trigger': true } })
  const attachments = [{ type: 'image', mediaType: 'image/png', id: 'img-1' }, { type: 'document', id: 'doc-1' }]
  const sent = fullWrapped(FLOW_RESEARCH_RULES, KOREAN)
  expect(await submit($, KOREAN, { attachments })).toMatchObject({ text: sent })
  expect(await submit($, `${KOREAN} +++`, { attachments })).toMatchObject({ text: sent })
  expect(s.entered).toEqual([sent, sent])
  expect(s.attachments).toEqual([attachments, attachments])
  expect(s.classified).toHaveLength(2)
})

test('a Korean prompt that is only pasted material is upgraded and the paste stays in the source', async ($, on) => {
  const s = world($, on, { types: JSON.stringify({ types: ['research'] }), extra: { 'skip-silent-trigger': true } })
  const pasted = `<pasted_content id="1">\n${KOREAN}\n</pasted_content id="1">`
  const sent = fullWrapped(FLOW_RESEARCH_RULES, pasted)
  expect(await submit($, `\n\n${pasted}\n`)).toMatchObject({ text: sent })
  expect(s.entered).toEqual([sent])
  expect(s.classified).toHaveLength(1)
})

test('a prompt with attachments and the off trigger is sent as it is with the attachments', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true } })
  const attachments = [{ type: 'image', id: 'img-1' }]
  expect(await submit($, `${KOREAN} ---`, { attachments })).toMatchObject({ text: KOREAN })
  expect(s.attachments).toEqual([attachments])
  expect(s.classified).toEqual([])
})

test('a Korean prompt is sent at once with the instruction and the rules, after the prompt type call only', async ($, on) => {
  const s = world($, on, { types: JSON.stringify({ types: ['research'] }) })
  const result = await submit($, `${KOREAN} +++`)
  const sent = fullWrapped(FLOW_RESEARCH_RULES, KOREAN)
  expect(result).toMatchObject({ text: sent })
  expect(result).not.toHaveProperty('drop')
  expect(s.others).toEqual([])
  expect(s.classified).toHaveLength(1)
  expect(s.classified[0]?.prompt).toContain(`<prompt>${KOREAN}</prompt>`)
  expect(s.entered).toEqual([sent])
  expect(s.filled).toEqual([])
  expect(s.copied).toEqual([])
})

test('a Korean prompt with a discuss type gets the two question lines', async ($, on) => {
  const s = world($, on, { types: JSON.stringify({ types: ['discuss'] }) })
  await submit($, `+++ ${KOREAN}`)
  expect(s.entered).toHaveLength(1)
  expect(s.entered[0]).toContain(QUESTION_LINE_ONE)
  expect(s.entered[0]).toContain(QUESTION_LINE_TWO)
  expect(s.entered[0]).toContain(`<source>\n${KOREAN}\n</source>`)
})

test('a Korean prompt with an execute type gets the execute lines and no question lines', async ($, on) => {
  const s = world($, on, { types: JSON.stringify({ types: ['execute'] }) })
  await submit($, `${KOREAN} +++`)
  expect(s.entered[0]).toContain(EXECUTE_LINE)
  expect(s.entered[0]).not.toContain(QUESTION_LINE_ONE)
})

test('a failed classify call sends the Korean prompt with the common rules only', async ($, on) => {
  const s = world($, on, { types: null })
  await submit($, `${KOREAN} +++`)
  expect(s.entered).toEqual([commonWrapped(KOREAN)])
  expect(s.classifyLogs).toEqual(['Prompt classify: haiku low · 0ms · failed'])
})

test('a classify call with no known type logs none and sends the common rules only', async ($, on) => {
  const s = world($, on, { types: JSON.stringify({ types: ['plan'] }) })
  await submit($, `${KOREAN} +++`)
  expect(s.entered).toEqual([commonWrapped(KOREAN)])
  expect(s.classifyLogs).toEqual(['Prompt classify: haiku low · 0ms · none'])
})

test('the classify log row lists the types found', async ($, on) => {
  const s = world($, on, { types: JSON.stringify({ types: ['research', 'execute'] }) })
  await submit($, `${KOREAN} +++`)
  expect(s.classifyLogs).toEqual(['Prompt classify: haiku low · 0ms · research, execute'])
  expect(s.logs).toEqual([])
})

test('each Korean prompt gets its own wrapper and nothing is kept for the next submit', async ($, on) => {
  const s = world($, on)
  await submit($, `${KOREAN} +++`)
  await submit($, '짧은 다음 질문 하나만 더 +++')
  expect(s.entered).toEqual([commonWrapped(KOREAN), commonWrapped('짧은 다음 질문 하나만 더')])
})

test('a prompt without Korean is sent at once without the trigger and with no model call', async ($, on) => {
  const s = world($, on)
  const result = await submit($, `${LONG} +++`)
  expect(result).toMatchObject({ text: LONG })
  expect(s.others).toEqual([])
  expect(s.classified).toEqual([])
  expect(s.entered).toEqual([LONG])
})

test('the off trigger sends the prompt as it is without a model call, even when every prompt is upgraded', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true } })
  const result = await submit($, `${KOREAN} ---`, { turnId: 'turn-1' })
  expect(result).toMatchObject({ text: KOREAN })
  expect(s.classified).toEqual([])
  expect(s.entered).toEqual([KOREAN])
})

test('without skip-silent-trigger a prompt without the trigger passes through untouched', async ($, on) => {
  const s = world($, on)
  expect(await submit($, KOREAN)).toMatchObject({ text: KOREAN })
  expect(s.classified).toEqual([])
})

test('skip-silent-trigger wraps a Korean prompt without the trigger and wraps a short one with the common rules and no classify call', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true } })
  await submit($, KOREAN)
  expect(s.classified).toHaveLength(1)
  await submit($, '짧은 말')
  expect(s.entered).toEqual([commonWrapped(KOREAN), commonWrapped('짧은 말')])
  expect(s.classified).toHaveLength(1)
})

test('env.CLAUDE_CODE_ENABLE_TODO_TOOLS set to 1 adds the todo lines to the hard rule, for a long and a short prompt', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true }, env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } })
  await submit($, KOREAN)
  await submit($, '짧은 말')
  const rules = `${FLOW_COMMON_RULES}\n${FLOW_TODO_RULES}`
  expect(s.entered).toEqual([fullWrapped(rules, KOREAN), fullWrapped(rules, '짧은 말')])
})

test('env.CLAUDE_CODE_ENABLE_TODO_TOOLS with any other value adds no todo line', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true }, env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '0' } })
  await submit($, KOREAN)
  expect(s.entered).toEqual([commonWrapped(KOREAN)])
})

test('models.classify from the settings reaches the classify call and its log row', async ($, on) => {
  const s = world($, on, { extra: { models: { classify: { model: 'sonnet', effort: 'medium' } } } })
  await submit($, `${KOREAN} +++`)
  expect(s.classified.map(c => `${c.model} ${c.effort}`)).toEqual(['sonnet medium'])
  expect(s.classifyLogs[0]).toMatch(/^Prompt classify: sonnet medium · /)
})

test('the removed keys in the settings change nothing', async ($, on) => {
  const removed = {
    'use-rewrite': true,
    'use-questions': true,
    'use-silent-upgrade': false,
    model: 'opus',
    effort: 'high',
    models: { ask: { model: 'opus', effort: 'high' }, rewrite: { model: 'opus', effort: 'high' } },
  }
  const s = world($, on, { extra: removed })
  const result = await submit($, `${KOREAN} +++`)
  expect(result).toMatchObject({ text: commonWrapped(KOREAN) })
  expect(s.others).toEqual([])
  expect(s.classified.map(c => `${c.model} ${c.effort}`)).toEqual(['haiku low'])
  expect(s.filled).toEqual([])
})
