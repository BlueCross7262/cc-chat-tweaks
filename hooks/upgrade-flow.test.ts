import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

const PLUGIN = 'cc-chat-tweaks'
const PANE = 'prompt-upgrade'
const USAGE_LINE = /^Prompt Upgrade (questions|rewrite|revise): /
const ORIGINAL_LINE = /^Prompt Upgrade original:$/
const LONG = 'please summarise the attached design document for me'
const USAGE = { input_tokens: 1, output_tokens: 1 }

type Setup = {
  entered: string[]
  filled: string[]
  closed: string[]
  models: string[]
  efforts: string[]
  ids: string[]
  events: string[]
  logs: string[]
  copied: string[]
  toasts: string[]
  prompts: string[]
  opens: number
  clock: ReturnType<typeof mock.clock> | undefined
}

const world = (
  $: Engine,
  on: On,
  options: { isFilled?: boolean; isCopied?: boolean; isPlaced?: boolean; answers?: Array<string | null>; enabled?: boolean; useQuestions?: boolean; silent?: boolean; box?: string; extra?: Record<string, unknown>; failFills?: number } = {},
): Setup => {
  const s: Setup = { entered: [], filled: [], closed: [], models: [], efforts: [], ids: [], events: [], logs: [], copied: [], toasts: [], prompts: [], opens: 0, clock: undefined }
  const answers = [...(options.answers ?? [])]
  s.clock = mock.clock(on, { now: 1000 })
  on('ui.toast', (_$, e) => {
    s.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  const group = { use: options.enabled ?? true, 'use-questions': options.useQuestions ?? true, 'use-silent-upgrade': options.silent ?? false, 'skip-silent-trigger': false, ...options.extra }
  mock.store(on, {})
  on('settings.read', (_$, e) => ({ value: (e as { source?: string }).source === 'user' ? { ccChatTweaks: { prompt: { 'prompt-upgrade': group } } } : {} }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('prompt.read', () => ({ value: { text: options.box ?? '', cursor: 0 } }) as never)
  on('ui.open', () => (s.opens++, { value: options.isPlaced === false ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true } }) as never)
  on('ui.close', (_$, e) => {
    s.closed.push((e as { id: string }).id)
    return { value: undefined } as never
  })
  let failFills = options.failFills ?? 0
  on('prompt.fill', (_$, e) => {
    s.filled.push((e as { text: string }).text)
    s.events.push(`fill:${(e as { text: string }).text}`)
    if (failFills > 0) {
      failFills -= 1
      return { isFilled: false } as never
    }
    return { isFilled: options.isFilled ?? true } as never
  })
  on('ui.copy', (_$, e) => {
    s.copied.push((e as { text: string }).text)
    return { value: { isCopied: options.isCopied ?? true } } as never
  })
  on('model.complete', (_$, e) => {
    s.models.push((e as { system?: string }).system?.slice(0, 6) ?? '')
    s.prompts.push((e as { prompt?: string }).prompt ?? '')
    s.efforts.push((e as { effort?: string }).effort ?? 'none')
    s.ids.push((e as { model?: string }).model ?? 'none')
    const text = answers.shift()
    return {
      value: text === null || text === undefined
        ? { isAnswered: false, reason: 'api-error', status: 500, error: 'server_error' }
        : { isAnswered: true, text, usage: USAGE },
    } as never
  })
  on('ui.log', (_$, e) => {
    s.logs.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('prompt.submit', (_$, e) => {
    s.entered.push((e as { text: string }).text)
    s.events.push(`submit:${(e as { text: string }).text}`)
    return { text: (e as { text: string }).text } as never
  })

  return s
}

const settle = (s: Setup) => s.clock?.advance(0)

const composer = { kind: 'composer' } as const

const submit = ($: Engine, text: string, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, wait: false, origin: composer, ...extra })

test('a long composer prompt is dropped, upgraded and resubmitted once', async ($, on) => {
  const s = world($, on, {
    answers: [
      JSON.stringify({ questions: [{ q: 'Which format?', options: ['table', 'bullets', 'prose'] }] }),
      'Summarise the design document as bullets.',
    ],
  })
  const result = await submit($, LONG)
  await settle(s)
  expect(s.logs.filter(line => !USAGE_LINE.test(line) && !ORIGINAL_LINE.test(line) && line !== LONG)).toEqual([])
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.entered).toEqual([])

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })
  await $.ui.press({ plugin: PLUGIN, key: 'q0o1', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Summarise the design document as bullets.')

  await $.ui.press({ plugin: PLUGIN, key: '이 프롬프트 보내기', requestId: PANE })
  expect(s.entered).toEqual(['Summarise the design document as bullets.'])
  expect(s.filled).toEqual([''])
  expect(s.closed).toContain(PANE)

  const again = await submit($, 'Summarise the design document as bullets.', { origin: { kind: 'plugin', name: PLUGIN, asUser: true } })
  expect(again).toMatchObject({ text: 'Summarise the design document as bullets.' })
})

test('no questions goes straight to the rewrite and Send original sends the original', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), 'A rewritten prompt.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.efforts).toEqual(['low', 'low'])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('A rewritten prompt.')
  await $.ui.press({ plugin: PLUGIN, key: '원문 그대로 보내기', requestId: PANE })
  expect(s.entered).toEqual([LONG])
})

test('a Haiku failure falls back to the original prompt', async ($, on) => {
  const s = world($, on, { answers: [null, null] })
  await submit($, LONG)
  await settle(s)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(LONG)
  expect(await ui.find({ type: 'Text', text: /did not answer/ })).toBeDefined()
  await $.ui.press({ plugin: PLUGIN, key: '이 프롬프트 보내기', requestId: PANE })
  expect(s.entered).toEqual([LONG])
})

test('Cancel puts the original back in the prompt box and enters nothing', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [{ q: 'Which?', options: ['a', 'b'] }] })] })
  await submit($, LONG)
  await settle(s)
  await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })
  await $.ui.press({ plugin: PLUGIN, key: '취소', requestId: PANE })
  expect(s.filled).toEqual([LONG])
  expect(s.entered).toEqual([])
})

test('a pane that cannot be placed lets the prompt through', async ($, on) => {
  const s = world($, on, { isPlaced: false })
  const result = await submit($, LONG)
  expect(result).toMatchObject({ text: LONG })
  expect(s.entered).toEqual([LONG])
  expect(s.models).toEqual([])
})

test('nothing is intercepted while disabled, or for other origins and slash commands', async ($, on) => {
  const off = world($, on, { enabled: false })
  expect(await submit($, LONG)).toMatchObject({ text: LONG })
  expect(off.entered).toEqual([LONG])
})

test('a second prompt while the pane is open passes through', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [{ q: 'Which?', options: ['a', 'b'] }] })] })
  await submit($, LONG)
  await settle(s)
  const second = await submit($, 'another long prompt that is typed meanwhile')
  expect(second).toMatchObject({ text: 'another long prompt that is typed meanwhile' })
  expect(s.entered).toEqual(['another long prompt that is typed meanwhile'])
})

const QUESTION = JSON.stringify({ questions: [{ q: 'Which?', options: ['a', 'b'] }] })

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })

test('Skip the rest upgrades without answers', async ($, on) => {
  const s = world($, on, { answers: [QUESTION, 'Upgraded without answers.'] })
  await submit($, LONG)
  await settle(s)
  const ui = await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: '나머지 건너뛰고 업그레이드', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Upgraded without answers.')
})

test('a draft that Haiku wraps in prompt tags is shown without them', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), '<prompt>Clean draft.</prompt>'] })
  await submit($, LONG)
  await settle(s)
  const ui = await mountPane($)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('Clean draft.')
})

test('Use recommended and upgrade answers the open questions and rewrites', async ($, on) => {
  const withPick = JSON.stringify({ questions: [{ q: 'Which?', options: ['a', 'b'], recommended: 1 }] })
  const s = world($, on, { answers: [withPick, 'Upgraded with the recommended answer.'] })
  await submit($, LONG)
  await settle(s)
  const ui = await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: '권장안으로 업그레이드', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Upgraded with the recommended answer.')
})

test('a revision replaces the draft and Undo brings the previous one back', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), 'First draft.', 'Second draft.'] })
  await submit($, LONG)
  await settle(s)
  const ui = await mountPane($)
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('First draft.')
  await $.ui.input({ plugin: PLUGIN, key: 'revise', text: 'make it shorter', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Second draft.')
  await $.ui.press({ plugin: PLUGIN, key: '수정 되돌리기', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('First draft.')
})

test('a failed revision keeps the draft and says so', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), 'First draft.', null] })
  await submit($, LONG)
  await settle(s)
  const ui = await mountPane($)
  await $.ui.input({ plugin: PLUGIN, key: 'revise', text: 'make it shorter', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('First draft.')
  expect(await ui.find({ type: 'Text', text: /unchanged/ })).toBeDefined()
})

test('Edit in prompt box fills the draft and lets the next submit through once', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), 'Draft to edit.', JSON.stringify({ questions: [] }), 'Another draft.'] })
  await submit($, LONG)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: '입력창에서 편집', requestId: PANE })
  expect(s.filled).toEqual(['Draft to edit.'])
  const edited = await submit($, 'Draft to edit, then changed by hand.')
  expect(edited).toMatchObject({ text: 'Draft to edit, then changed by hand.' })
  const next = await submit($, LONG)
  expect(next).toMatchObject({ drop: expect.any(String) })
})

test('a Haiku answer that arrives after Cancel is ignored', async ($, on) => {
  const s = world($, on, { answers: [QUESTION, 'Late draft.'] })
  await submit($, LONG)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: '취소', requestId: PANE }).catch(() => undefined)
  await settle(s)
  expect(s.entered).toEqual([])
})

test('a prompt with an attachment, a slash command and a peer message pass through', async ($, on) => {
  const s = world($, on)
  expect(await submit($, LONG, { attachments: [{ type: 'image' }] })).toMatchObject({ text: LONG })
  expect(await submit($, '/compact the conversation please')).toMatchObject({ text: '/compact the conversation please' })
  expect(await submit($, LONG, { origin: { kind: 'peer' } })).toMatchObject({ text: LONG })
  expect(await submit($, LONG, { turnId: 'turn-1' })).toMatchObject({ text: LONG })
  expect(s.models).toEqual([])
})

const LONG_TEXT = 'a long original prompt '.repeat(120)

test('when the prompt box cannot be refilled the full text goes to the clipboard, never a shortened copy', async ($, on) => {
  const s = world($, on, { isFilled: false, answers: [QUESTION] })
  await submit($, LONG_TEXT)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: '취소', requestId: PANE })
  expect(s.copied).toEqual([LONG_TEXT])
  expect(s.toasts.join('')).not.toContain('...')
})

test('when neither refill nor clipboard works the toast carries the whole text', async ($, on) => {
  const s = world($, on, { isFilled: false, isCopied: false, answers: [QUESTION] })
  await submit($, LONG_TEXT)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: '취소', requestId: PANE })
  expect(s.toasts.some(text => text.includes(LONG_TEXT))).toBe(true)
})

test('use-questions false skips the question step', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Straight to the rewrite.'] })
  await submit($, LONG)
  await settle(s)
  const ui = await mountPane($)
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Straight to the rewrite.')
  expect(s.models.length).toBe(1)
})

const TRIGGERED = '+++ ' + LONG

test('a trailing or leading trigger upgrades silently: no pane, no questions, no trigger sent to Haiku, nothing sent', async ($, on) => {
  const s = world($, on, { silent: true, useQuestions: false, answers: ['Silently upgraded prompt.'], box: TRIGGERED })
  const result = await submit($, TRIGGERED)
  await settle(s)
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.opens).toBe(0)
  expect(s.models).toHaveLength(1)
  expect(s.prompts[0]).toContain(LONG)
  expect(s.prompts[0]).not.toContain('+++')
  expect(s.filled).toEqual(['Silently upgraded prompt.'])
  expect(s.entered).toEqual([])
})

test('the draft a silent run puts in the prompt box passes the next submit once', async ($, on) => {
  const s = world($, on, { silent: true, useQuestions: false, answers: ['Silently upgraded prompt.', JSON.stringify({ questions: [] })], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  const edited = await submit($, 'Silently upgraded prompt, then changed by hand.')
  expect(edited).toMatchObject({ text: 'Silently upgraded prompt, then changed by hand.' })
  expect(await submit($, TRIGGERED)).toMatchObject({ drop: expect.any(String) })
})

test('the trigger typed after a silent draft upgrades the draft again instead of sending it', async ($, on) => {
  const s = world($, on, { silent: true, useQuestions: false, answers: ['First draft.', 'Second draft.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.filled).toEqual(['First draft.'])
  const again = await submit($, 'First draft, with a change. +++')
  await settle(s)
  expect(again).toMatchObject({ drop: expect.any(String) })
  expect(s.models).toHaveLength(2)
  expect(s.prompts[1]).toContain('First draft, with a change.')
  expect(s.prompts[1]).not.toContain('+++')
  expect(s.entered).toEqual([])
})

test('a silent run whose Haiku call fails puts the original without the trigger in the prompt box and says so', async ($, on) => {
  const s = world($, on, { silent: true, useQuestions: false, answers: [null], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.filled).toEqual([LONG])
  expect(s.entered).toEqual([])
  expect(s.toasts.join(' ')).toMatch(/did not answer/)
})

test('a silent run does not overwrite what the person typed meanwhile and puts the draft on the clipboard', async ($, on) => {
  const s = world($, on, { silent: true, useQuestions: false, answers: ['Silently upgraded prompt.'], box: 'something typed later' })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.filled).toEqual([])
  expect(s.entered).toEqual([])
  expect(s.copied).toEqual(['Silently upgraded prompt.'])
  expect(s.toasts.join(' ')).toMatch(/clipboard/)
})

test('a prompt submitted while a silent run is working passes through untouched', async ($, on) => {
  const s = world($, on, { silent: true, useQuestions: false, answers: ['Silently upgraded prompt.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  const second = await submit($, '+++ another long prompt typed meanwhile')
  await settle(s)
  expect(second).toMatchObject({ text: '+++ another long prompt typed meanwhile' })
})

test('with use-silent-upgrade on a prompt without the trigger passes through with no pane and no upgrade', async ($, on) => {
  const s = world($, on, { silent: true, answers: ['Unused draft.'] })
  const result = await submit($, LONG)
  await settle(s)
  expect(result).toMatchObject({ text: LONG })
  expect(s.opens).toBe(0)
  expect(s.models).toEqual([])
  expect(s.filled).toEqual([])
  expect(s.entered).toEqual([LONG])
})

test('skip-silent-trigger upgrades a prompt without the trigger, with no pane and nothing sent', async ($, on) => {
  const s = world($, on, {
    silent: true,
    useQuestions: false,
    extra: { 'skip-silent-trigger': true },
    answers: ['Always silent draft.'],
  })
  const result = await submit($, LONG)
  await settle(s)
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.opens).toBe(0)
  expect(s.models).toHaveLength(1)
  expect(s.prompts[0]).toContain(LONG)
  expect(s.filled).toEqual(['Always silent draft.'])
  expect(s.entered).toEqual([])
})

test('skip-silent-trigger still passes a short prompt', async ($, on) => {
  const s = world($, on, { silent: true, extra: { 'skip-silent-trigger': true }, answers: ['Unused.'] })
  expect(await submit($, 'too short')).toMatchObject({ text: 'too short' })
  expect(s.models).toEqual([])
})

test('skip-silent-trigger does nothing while use-silent-upgrade is false', async ($, on) => {
  const s = world($, on, { silent: false, extra: { 'skip-silent-trigger': true }, answers: [QUESTION] })
  const result = await submit($, LONG)
  await settle(s)
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.opens).toBe(1)
})

const RECOMMENDED_QUESTION = JSON.stringify({ questions: [{ q: 'Which format?', options: ['table', 'bullets', 'prose'], recommended: 1 }] })

test('a silent run asks inside, applies the recommended answer and fills the draft', async ($, on) => {
  const s = world($, on, { silent: true, answers: [RECOMMENDED_QUESTION, 'Draft with bullets.'], box: TRIGGERED })
  const result = await submit($, TRIGGERED)
  await settle(s)
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.opens).toBe(0)
  expect(s.models).toHaveLength(2)
  expect(s.prompts[1]).toContain('Q: Which format?\nA: bullets')
  expect(s.filled).toEqual(['Draft with bullets.'])
  expect(s.entered).toEqual([])
  expect(s.logs.filter(line => USAGE_LINE.test(line)).map(line => line.split(':')[0])).toEqual([
    'Prompt Upgrade questions',
    'Prompt Upgrade rewrite',
  ])
})

test('a silent run leaves a question without a recommended answer unanswered', async ($, on) => {
  const s = world($, on, { silent: true, answers: [QUESTION, 'Draft without answers.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.models).toHaveLength(2)
  expect(s.prompts[1]).not.toContain('Q: ')
  expect(s.filled).toEqual(['Draft without answers.'])
})

test('a silent run still rewrites when the questions call fails', async ($, on) => {
  const s = world($, on, { silent: true, answers: [null, 'Draft after a failed ask.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.models).toHaveLength(2)
  expect(s.filled).toEqual(['Draft after a failed ask.'])
})

test('use-questions false makes the silent run a single call', async ($, on) => {
  const s = world($, on, { silent: true, useQuestions: false, answers: ['Single call draft.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.models).toHaveLength(1)
  expect(s.filled).toEqual(['Single call draft.'])
})

test('with use-silent-upgrade off the trigger is ordinary text and the pane path runs', async ($, on) => {
  const s = world($, on, { silent: false, answers: [QUESTION] })
  const result = await submit($, TRIGGERED)
  await settle(s)
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.opens).toBe(1)
})

test('every Haiku call writes one log line with model and time, and nothing goes to the prompt or the toasts', async ($, on) => {
  const s = world($, on, { answers: [QUESTION, 'Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: 'q0o1', requestId: PANE })
  const lines = s.logs.filter(line => USAGE_LINE.test(line))
  expect(lines).toHaveLength(2)
  expect(lines[0]).toMatch(/^Prompt Upgrade questions: sonnet low · \d+(ms|\.\ds)$/)
  expect(lines[1]).toMatch(/^Prompt Upgrade rewrite: sonnet low · /)
  expect(s.toasts).toEqual([])
  expect(s.entered).toEqual([])
})

test('the original prompt is logged as a header row and then its own rows, right after each call row', async ($, on) => {
  const s = world($, on, { answers: [QUESTION, 'Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: 'q0o1', requestId: PANE })
  const calls = s.logs.flatMap((line, i) => (USAGE_LINE.test(line) ? [i] : []))
  expect(calls).toHaveLength(2)
  for (const i of calls) {
    expect(s.logs[i + 1]).toBe('Prompt Upgrade original:')
    expect(s.logs[i + 2]).toBe(LONG)
  }
})

test('a multi-line original is logged one row per line, without blank rows', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Upgraded prompt.'] })
  const text = 'first line of a long prompt\nsecond line of a long prompt\n\nfourth line after a blank one'
  await submit($, text)
  await settle(s)
  const at = s.logs.findIndex(entry => ORIGINAL_LINE.test(entry))
  expect(at).toBeGreaterThan(-1)
  expect(s.logs.slice(at, at + 4)).toEqual([
    'Prompt Upgrade original:',
    'first line of a long prompt',
    'second line of a long prompt',
    'fourth line after a blank one',
  ])
})

test('no log text holds a line break, because the engine draws one log as one row and breaks it into a garbled character', async ($, on) => {
  const s = world($, on, { answers: [QUESTION, 'Upgraded prompt.\nSecond line.'] })
  await submit($, 'first line of a long prompt\nsecond line of a long prompt')
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: 'q0o1', requestId: PANE })
  expect(s.logs.length).toBeGreaterThan(0)
  for (const entry of s.logs) expect(entry).not.toMatch(/[\r\n]/)
})

test('a very long original is cut at 2000 characters in the log', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Upgraded prompt.'] })
  await submit($, 'x'.repeat(5000))
  await settle(s)
  const at = s.logs.findIndex(item => ORIGINAL_LINE.test(item))
  const body = s.logs[at + 1] ?? ''
  expect(body.length).toBe(2000)
  expect(body.endsWith('x...')).toBe(true)
})

test('model and effort from the settings reach every call and its log line', async ($, on) => {
  const s = world($, on, { extra: { model: 'sonnet', effort: 'high' }, answers: [QUESTION, 'Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: 'q0o1', requestId: PANE })
  expect(s.ids).toEqual(['sonnet', 'sonnet'])
  expect(s.efforts).toEqual(['high', 'high'])
  expect(s.logs.filter(line => USAGE_LINE.test(line)).every(line => line.includes('sonnet high'))).toBe(true)
})

test('a model or effort that is not valid falls back to sonnet and low', async ($, on) => {
  const s = world($, on, { extra: { model: '  ', effort: 'ultra' }, answers: [JSON.stringify({ questions: [] }), 'Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.ids).toEqual(['sonnet', 'sonnet'])
  expect(s.efforts).toEqual(['low', 'low'])
})

test('Send this prompt clears the prompt box before it sends', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), 'Draft to send.'] })
  await submit($, LONG)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: '이 프롬프트 보내기', requestId: PANE })
  expect(s.events.indexOf('fill:')).toBeGreaterThan(-1)
  expect(s.events.indexOf('fill:')).toBeLessThan(s.events.indexOf('submit:Draft to send.'))

})

test('Send original clears the prompt box before it sends', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), 'Draft not sent.'] })
  await submit($, LONG)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: '원문 그대로 보내기', requestId: PANE })
  expect(s.events.indexOf('fill:')).toBeGreaterThan(-1)
  expect(s.events.indexOf('fill:')).toBeLessThan(s.events.indexOf(`submit:${LONG}`, 1))
})

test('a refused fill is retried until the prompt box is cleared', async ($, on) => {
  const s = world($, on, { failFills: 2, answers: [JSON.stringify({ questions: [] }), 'Draft to send.'] })
  await submit($, LONG)
  await settle(s)
  await mountPane($)
  const pressed = $.ui.press({ plugin: PLUGIN, key: '이 프롬프트 보내기', requestId: PANE })
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await s.clock?.advance(100)
  }
  await pressed
  expect(s.filled).toEqual(['', '', ''])
  expect(s.events.indexOf('fill:')).toBeLessThan(s.events.indexOf('submit:Draft to send.'))
  expect(s.entered).toContain('Draft to send.')
})

test('a Haiku call that fails still logs its line', async ($, on) => {
  const s = world($, on, { answers: [null, null] })
  await submit($, LONG)
  await settle(s)
  expect(s.logs.filter(line => USAGE_LINE.test(line)).length).toBeGreaterThan(0)
})
