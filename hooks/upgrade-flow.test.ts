import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

const PLUGIN = 'cc-chat-tweaks'
const PANE = 'prompt-upgrade'
const LONG = 'please summarise the attached design document for me'
const USAGE = { input_tokens: 1, output_tokens: 1 }

type Setup = {
  entered: string[]
  filled: string[]
  closed: string[]
  models: string[]
  logs: string[]
  copied: string[]
  toasts: string[]
  clock: ReturnType<typeof mock.clock> | undefined
}

const world = (
  $: Engine,
  on: On,
  options: { isFilled?: boolean; isCopied?: boolean; isPlaced?: boolean; answers?: Array<string | null>; enabled?: boolean; useQuestions?: boolean } = {},
): Setup => {
  const s: Setup = { entered: [], filled: [], closed: [], models: [], logs: [], copied: [], toasts: [], clock: undefined }
  const answers = [...(options.answers ?? [])]
  s.clock = mock.clock(on, { now: 1000 })
  on('ui.toast', (_$, e) => {
    s.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  const group = { 'use-prompt-upgrade': options.enabled ?? true, 'use-questions': options.useQuestions ?? true }
  mock.store(on, {})
  on('settings.read', (_$, e) => ({ value: (e as { source?: string }).source === 'user' ? { ccChatTweaks: { chat: group } } : {} }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('ui.open', () => ({ value: options.isPlaced === false ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true } }) as never)
  on('ui.close', (_$, e) => {
    s.closed.push((e as { id: string }).id)
    return { value: undefined } as never
  })
  on('prompt.fill', (_$, e) => {
    s.filled.push((e as { text: string }).text)
    return { isFilled: options.isFilled ?? true } as never
  })
  on('ui.copy', (_$, e) => {
    s.copied.push((e as { text: string }).text)
    return { value: { isCopied: options.isCopied ?? true } } as never
  })
  on('model.complete', (_$, e) => {
    s.models.push((e as { system?: string }).system?.slice(0, 6) ?? '')
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
  expect(s.logs).toEqual([])
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.entered).toEqual([])

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })
  await $.ui.press({ plugin: PLUGIN, key: 'q0o1', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Summarise the design document as bullets.')

  await $.ui.press({ plugin: PLUGIN, key: 'Send this prompt', requestId: PANE })
  expect(s.entered).toEqual(['Summarise the design document as bullets.'])
  expect(s.closed).toContain(PANE)

  const again = await submit($, 'Summarise the design document as bullets.', { origin: { kind: 'plugin', name: PLUGIN, asUser: true } })
  expect(again).toMatchObject({ text: 'Summarise the design document as bullets.' })
})

test('no questions goes straight to the rewrite and Send original sends the original', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), 'A rewritten prompt.'] })
  await submit($, LONG)
  await settle(s)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('A rewritten prompt.')
  await $.ui.press({ plugin: PLUGIN, key: 'Send original', requestId: PANE })
  expect(s.entered).toEqual([LONG])
})

test('a Haiku failure falls back to the original prompt', async ($, on) => {
  const s = world($, on, { answers: [null, null] })
  await submit($, LONG)
  await settle(s)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(LONG)
  expect(await ui.find({ type: 'Text', text: /did not answer/ })).toBeDefined()
  await $.ui.press({ plugin: PLUGIN, key: 'Send this prompt', requestId: PANE })
  expect(s.entered).toEqual([LONG])
})

test('Cancel puts the original back in the prompt box and enters nothing', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [{ q: 'Which?', options: ['a', 'b'] }] })] })
  await submit($, LONG)
  await settle(s)
  await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: {} as never, requestId: PANE })
  await $.ui.press({ plugin: PLUGIN, key: 'Cancel', requestId: PANE })
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
  await $.ui.press({ plugin: PLUGIN, key: 'Skip the rest, upgrade now', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Upgraded without answers.')
})

test('a revision replaces the draft and Undo brings the previous one back', async ($, on) => {
  const s = world($, on, { answers: [JSON.stringify({ questions: [] }), 'First draft.', 'Second draft.'] })
  await submit($, LONG)
  await settle(s)
  const ui = await mountPane($)
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('First draft.')
  await $.ui.input({ plugin: PLUGIN, key: 'revise', text: 'make it shorter', requestId: PANE })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Second draft.')
  await $.ui.press({ plugin: PLUGIN, key: 'Undo revision', requestId: PANE })
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
  await $.ui.press({ plugin: PLUGIN, key: 'Edit in prompt box', requestId: PANE })
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
  await $.ui.press({ plugin: PLUGIN, key: 'Cancel', requestId: PANE }).catch(() => undefined)
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
  await $.ui.press({ plugin: PLUGIN, key: 'Cancel', requestId: PANE })
  expect(s.copied).toEqual([LONG_TEXT])
  expect(s.toasts.join('')).not.toContain('...')
})

test('when neither refill nor clipboard works the toast carries the whole text', async ($, on) => {
  const s = world($, on, { isFilled: false, isCopied: false, answers: [QUESTION] })
  await submit($, LONG_TEXT)
  await settle(s)
  await mountPane($)
  await $.ui.press({ plugin: PLUGIN, key: 'Cancel', requestId: PANE })
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
