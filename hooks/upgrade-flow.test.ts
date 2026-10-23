import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { CLASSIFY_SYSTEM } from './upgrade-prompts'

const PLUGIN = 'cc-chat-tweaks'
const USAGE_LINE = /^Prompt (ask|rewrite): /
const LONG = 'please summarise the attached design document for me'
const USAGE = { input_tokens: 1, output_tokens: 1 }

type Setup = {
  entered: string[]
  origins: string[]
  filled: string[]
  closed: string[]
  models: string[]
  efforts: string[]
  ids: string[]
  events: string[]
  logs: string[]
  copied: string[]
  toasts: string[]
  decorations: unknown[]
  prompts: string[]
  classified: { model: string; effort: string; prompt: string }[]
  classifyLogs: string[]
  opens: number
  clock: ReturnType<typeof mock.clock> | undefined
}

const world = (
  $: Engine,
  on: On,
  options: { isFilled?: boolean; isCopied?: boolean; answers?: Array<string | null>; enabled?: boolean; useQuestions?: boolean; box?: string | string[]; extra?: Record<string, unknown>; failFills?: number; types?: string | null } = {},
): Setup => {
  const s: Setup = { entered: [], origins: [], filled: [], closed: [], models: [], efforts: [], ids: [], events: [], logs: [], copied: [], toasts: [], decorations: [], prompts: [], classified: [], classifyLogs: [], opens: 0, clock: undefined }
  const answers = [...(options.answers ?? [])]
  s.clock = mock.clock(on, { now: 1000 })
  on('ui.toast', (_$, e) => {
    s.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  const group = { use: options.enabled ?? true, 'use-questions': options.useQuestions ?? true, 'skip-silent-trigger': false, ...options.extra }
  mock.store(on, {})
  on('settings.read', (_$, e) => ({ value: (e as { source?: string }).source === 'user' ? { ccChatTweaks: { prompt: { 'prompt-upgrade': group } } } : {} }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  const boxReads = Array.isArray(options.box) ? [...options.box] : [options.box ?? '']
  on('prompt.read', () => ({ value: { text: boxReads.length > 1 ? boxReads.shift() : boxReads[0], cursor: 0 } }) as never)
  on('ui.open', () => (s.opens++, { value: { isPlaced: true } }) as never)
  on('ui.close', (_$, e) => {
    s.closed.push((e as { id: string }).id)
    return { value: undefined } as never
  })
  let failFills = options.failFills ?? 0
  on('prompt.fill', (_$, e) => {
    s.filled.push((e as { text: string }).text)
    s.decorations.push((e as { decorations?: unknown }).decorations)
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
    const call = e as { system?: string; model?: string; effort?: string; prompt?: string }
    if (call.system === CLASSIFY_SYSTEM) {
      s.classified.push({ model: call.model ?? 'none', effort: call.effort ?? 'none', prompt: call.prompt ?? '' })
      const types = options.types === undefined ? JSON.stringify({ types: [] }) : options.types
      return {
        value: types === null
          ? { isAnswered: false, reason: 'api-error', status: 500, error: 'server_error' }
          : { isAnswered: true, text: types, usage: USAGE },
      } as never
    }
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
    const text = (e as { text: string }).text
    if (text.startsWith('Prompt classify:')) s.classifyLogs.push(text)
    else s.logs.push(text)
    return { value: undefined } as never
  })
  on('prompt.edit', (_$, e) => {
    const edit = e as { text: string; start: number; end: number; inputText: string }
    const text = edit.text.slice(0, edit.start) + edit.inputText + edit.text.slice(edit.end)
    return { text, cursor: edit.start + edit.inputText.length } as never
  })
  on('prompt.submit', (_$, e) => {
    s.entered.push((e as { text: string }).text)
    s.origins.push((e as { origin?: { kind: string } }).origin?.kind ?? 'none')
    s.events.push(`submit:${(e as { text: string }).text}`)
    return { text: (e as { text: string }).text } as never
  })

  return s
}

const settle = async (s: Setup) => {
  await s.clock?.advance(0)
  await s.clock?.advance(300)
}

const composer = { kind: 'composer' } as const

const submit = ($: Engine, text: string, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, wait: false, origin: composer, ...extra })

test('nothing is intercepted while disabled, or for other origins and slash commands', async ($, on) => {
  const off = world($, on, { enabled: false, extra: { 'skip-silent-trigger': true } })
  expect(await submit($, LONG)).toMatchObject({ text: LONG })
  expect(off.entered).toEqual([LONG])
  expect(off.models).toEqual([])
  expect(off.classified).toEqual([])
})

const QUESTION = JSON.stringify({ questions: [{ q: 'Which?', options: ['a', 'b'] }] })

test('a draft that Haiku wraps in prompt tags is shown without them', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['<prompt>Clean draft.</prompt>'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.filled).toEqual(['Clean draft.'])
})

test('a prompt with an attachment, a slash command and a peer message pass through', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true } })
  expect(await submit($, LONG, { attachments: [{ type: 'image' }] })).toMatchObject({ text: LONG })
  expect(await submit($, '/compact the conversation please')).toMatchObject({ text: '/compact the conversation please' })
  expect(await submit($, LONG, { origin: { kind: 'peer' } })).toMatchObject({ text: LONG })
  expect(await submit($, LONG, { origin: { kind: 'peer' }, turnId: 'turn-1' })).toMatchObject({ text: LONG })
  expect(s.models).toEqual([])
})

test('a prompt the person types while a turn runs is upgraded like any other', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, answers: ['Draft typed mid-turn.'], box: LONG })
  const result = await submit($, LONG, { turnId: 'turn-1' })
  await settle(s)
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.models).toHaveLength(1)
  expect(s.filled).toEqual(['Draft typed mid-turn.'])
  expect(s.entered).toEqual([])
})

test('the draft filled for a mid-turn prompt passes the next submit while the turn still runs', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, answers: ['Draft typed mid-turn.'], box: LONG })
  await submit($, LONG, { turnId: 'turn-1' })
  await settle(s)
  const again = await submit($, 'Draft typed mid-turn.', { turnId: 'turn-1' })
  expect(again).toMatchObject({ text: 'Draft typed mid-turn.' })
  expect(again).not.toHaveProperty('drop')
  expect(s.models).toHaveLength(1)
  expect(s.entered).toEqual(['Draft typed mid-turn.'])
})

test('the off trigger sends a prompt typed while a turn runs as it is', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true }, answers: ['Never used.'] })
  const result = await submit($, `${LONG} ---`, { turnId: 'turn-1' })
  await settle(s)
  expect(result).toMatchObject({ text: LONG })
  expect(result).not.toHaveProperty('drop')
  expect(s.models).toEqual([])
  expect(s.entered).toEqual([LONG])
})

const LONG_DRAFT = Array(120).fill('a long upgraded draft').join(' ')

test('when the prompt box cannot be refilled the full draft goes to the clipboard, never a shortened copy', async ($, on) => {
  const s = world($, on, { isFilled: false, useQuestions: false, answers: [LONG_DRAFT], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.copied).toEqual([LONG_DRAFT])
  expect(s.toasts.join('')).not.toContain('...')
})

test('when neither refill nor clipboard works the toast carries the whole draft', async ($, on) => {
  const s = world($, on, { isFilled: false, isCopied: false, useQuestions: false, answers: [LONG_DRAFT], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.toasts.some(text => text.includes(LONG_DRAFT))).toBe(true)
})

const TRIGGERED = '+++ ' + LONG

test('the off trigger sends the prompt as it is without a model call, even when every prompt is upgraded', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true }, answers: ['Never used.'] })
  const result = await submit($, `${LONG} ---`)
  await settle(s)
  expect(result).toMatchObject({ text: LONG })
  expect(result).not.toHaveProperty('drop')
  expect(s.opens).toBe(0)
  expect(s.models).toHaveLength(0)
  expect(s.entered).toEqual([LONG])
  expect(s.origins).toEqual(['composer'])
  expect(s.filled).toEqual([])
})

test('a trailing or leading trigger upgrades silently: no pane, no questions, no trigger sent to Haiku, nothing sent', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Silently upgraded prompt.'], box: TRIGGERED })
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

test('a user whose retired use-silent-upgrade is false gets the silent upgrade with skip-silent-trigger, with no pane', async ($, on) => {
  const s = world($, on, {
    useQuestions: false,
    extra: { 'use-silent-upgrade': false, 'skip-silent-trigger': true },
    answers: ['Silent draft for the old false user.'],
    box: LONG,
  })
  const result = await submit($, LONG)
  await settle(s)
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.opens).toBe(0)
  expect(s.closed).toEqual([])
  expect(s.models).toHaveLength(1)
  expect(s.filled).toEqual(['Silent draft for the old false user.'])
  expect(s.entered).toEqual([])
})

test('a user whose retired use-silent-upgrade is false has a prompt without the trigger passed through untouched', async ($, on) => {
  const s = world($, on, { extra: { 'use-silent-upgrade': false }, answers: [QUESTION] })
  const result = await submit($, LONG)
  await settle(s)
  expect(result).toMatchObject({ text: LONG })
  expect(result).not.toHaveProperty('drop')
  expect(s.opens).toBe(0)
  expect(s.models).toEqual([])
  expect(s.classified).toEqual([])
  expect(s.entered).toEqual([LONG])
})

test('the silent trigger works for a user whose retired use-silent-upgrade is false', async ($, on) => {
  const old = { 'use-silent-upgrade': false, 'skip-silent-trigger': true }
  const upgraded = world($, on, { useQuestions: false, extra: old, answers: ['Draft after the trigger.'], box: TRIGGERED })
  expect(await submit($, TRIGGERED)).toMatchObject({ drop: expect.any(String) })
  await settle(upgraded)
  expect(upgraded.prompts[0]).not.toContain('+++')
  expect(upgraded.filled).toEqual(['Draft after the trigger.'])
  expect(upgraded.opens).toBe(0)
})

test('the off trigger sends the prompt as it is for a user whose retired use-silent-upgrade is false', async ($, on) => {
  const s = world($, on, { extra: { 'use-silent-upgrade': false, 'skip-silent-trigger': true }, answers: ['Never used.'] })
  const result = await submit($, `${LONG} ---`)
  await settle(s)
  expect(result).toMatchObject({ text: LONG })
  expect(s.opens).toBe(0)
  expect(s.models).toEqual([])
  expect(s.classified).toEqual([])
  expect(s.entered).toEqual([LONG])
})

test('the draft a silent run puts in the prompt box passes the next submit once', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Silently upgraded prompt.', JSON.stringify({ questions: [] })], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  const edited = await submit($, 'Silently upgraded prompt, then changed by hand.')
  expect(edited).toMatchObject({ text: 'Silently upgraded prompt, then changed by hand.' })
  expect(await submit($, TRIGGERED)).toMatchObject({ drop: expect.any(String) })
})

const AFTER_PASS = 5 * 60 * 1000 + 1000

test('the filled draft passes whatever its white space, even after the time limit, and the pass is spent', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Silently upgraded prompt.\nSecond sentence.', 'Another draft.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.filled).toEqual(['Silently upgraded prompt.\nSecond sentence.'])
  await s.clock?.advance(AFTER_PASS)
  const same = await submit($, '  Silently   upgraded prompt. Second\nsentence.  ')
  expect(same).toMatchObject({ text: '  Silently   upgraded prompt. Second\nsentence.  ' })
  expect(s.models).toHaveLength(1)
  expect(await submit($, TRIGGERED)).toMatchObject({ drop: expect.any(String) })
})

test('an edited draft is upgraded again once the time limit is over', async ($, on) => {
  const s = world($, on, {
    useQuestions: false,
    extra: { 'skip-silent-trigger': true },
    answers: ['Silently upgraded prompt.', 'Second draft.'],
    box: TRIGGERED,
  })
  await submit($, TRIGGERED)
  await settle(s)
  await s.clock?.advance(AFTER_PASS)
  const edited = await submit($, 'Silently upgraded prompt, then changed by hand after a long wait.')
  await settle(s)
  expect(edited).toMatchObject({ drop: expect.any(String) })
  expect(s.models).toHaveLength(2)
})

test('the trigger typed after a silent draft upgrades the draft again instead of sending it', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['First draft.', 'Second draft.'], box: TRIGGERED })
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
  const s = world($, on, { useQuestions: false, answers: [null], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.filled).toEqual([LONG])
  expect(s.entered).toEqual([])
  expect(s.toasts.join(' ')).toMatch(/did not answer/)
})

test('a silent run does not overwrite what the person typed meanwhile and puts the draft on the clipboard', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Silently upgraded prompt.'], box: ['', 'something typed later'] })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.filled).toEqual([])
  expect(s.entered).toEqual([])
  expect(s.copied).toEqual(['Silently upgraded prompt.'])
  expect(s.toasts.join(' ')).toMatch(/clipboard/)
})

test('a silent run fills the draft when the box still holds what the engine left there, such as a paste placeholder', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Silently upgraded prompt.'], box: '[Pasted text #1 +3 lines]' })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.filled).toEqual(['Silently upgraded prompt.'])
  expect(s.copied).toEqual([])
  expect(s.toasts.join(' ')).not.toMatch(/clipboard/)
})

test('a prompt submitted while a silent run is working passes through untouched', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Silently upgraded prompt.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  const second = await submit($, '+++ another long prompt typed meanwhile')
  await settle(s)
  expect(second).toMatchObject({ text: '+++ another long prompt typed meanwhile' })
})

test('without skip-silent-trigger a prompt without the trigger passes through with no upgrade', async ($, on) => {
  const s = world($, on, { answers: ['Unused draft.'] })
  const result = await submit($, LONG)
  await settle(s)
  expect(result).toMatchObject({ text: LONG })
  expect(s.opens).toBe(0)
  expect(s.models).toEqual([])
  expect(s.classified).toEqual([])
  expect(s.filled).toEqual([])
  expect(s.entered).toEqual([LONG])
})

test('skip-silent-trigger upgrades a prompt without the trigger, with no pane and nothing sent', async ($, on) => {
  const s = world($, on, {
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
  const s = world($, on, { extra: { 'skip-silent-trigger': true }, answers: ['Unused.'] })
  expect(await submit($, 'too short')).toMatchObject({ text: 'too short' })
  expect(s.models).toEqual([])
})

const RECOMMENDED_QUESTION = JSON.stringify({ questions: [{ q: 'Which format?', options: ['table', 'bullets', 'prose'], recommended: 1 }] })

test('a silent run asks inside, applies the recommended answer and fills the draft', async ($, on) => {
  const s = world($, on, { answers: [RECOMMENDED_QUESTION, 'Draft with bullets.'], box: TRIGGERED })
  const result = await submit($, TRIGGERED)
  await settle(s)
  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(s.opens).toBe(0)
  expect(s.models).toHaveLength(2)
  expect(s.prompts[1]).toContain('Q: Which format?\nA: bullets')
  expect(s.filled).toEqual(['Draft with bullets.'])
  expect(s.entered).toEqual([])
  expect(s.logs.filter(line => USAGE_LINE.test(line))).toHaveLength(2)
  expect(s.logs.filter(line => line.startsWith('Prompt answer: '))).toEqual(['Prompt answer: Which format? → bullets'])
})

test('a silent run writes one answer row for each recommended answer it applies', async ($, on) => {
  const two = JSON.stringify({
    questions: [
      { q: 'Which format?', options: ['table', 'bullets', 'prose'], recommended: 1 },
      { q: 'How long?', options: ['short', 'long'] },
      { q: 'Which language?', options: ['English', 'Korean'], recommended: 0 },
    ],
  })
  const s = world($, on, { answers: [two, 'Draft with two answers.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.logs.filter(line => line.startsWith('Prompt answer: '))).toEqual([
    'Prompt answer: Which format? → bullets',
    'Prompt answer: Which language? → English',
  ])
})

test('a silent run leaves a question without a recommended answer unanswered', async ($, on) => {
  const s = world($, on, { answers: [QUESTION, 'Draft without answers.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.models).toHaveLength(2)
  expect(s.prompts[1]).not.toContain('Q: ')
  expect(s.filled).toEqual(['Draft without answers.'])
  expect(s.logs.filter(line => line.startsWith('Prompt answer: '))).toEqual([])
})

test('a silent run still rewrites when the questions call fails', async ($, on) => {
  const s = world($, on, { answers: [null, 'Draft after a failed ask.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.models).toHaveLength(2)
  expect(s.filled).toEqual(['Draft after a failed ask.'])
})

test('use-questions false makes the silent run one classify call and one rewrite call', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Single call draft.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.models).toHaveLength(1)
  expect(s.classified).toHaveLength(1)
  expect(s.filled).toEqual(['Single call draft.'])
})

test('every model call writes one log row with the model, effort, time and the original prompt, and nothing goes to the prompt or the toasts', async ($, on) => {
  const s = world($, on, { answers: [QUESTION, 'Upgraded prompt.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  const rows = s.logs.filter(line => USAGE_LINE.test(line))
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatch(new RegExp(`^Prompt ask: sonnet low · \\d+(ms|\\.\\ds) · ${LONG}$`))
  expect(rows[1]).toMatch(new RegExp(`^Prompt rewrite: sonnet low · \\d+(ms|\\.\\ds) · ${LONG}$`))
  expect(s.logs).toHaveLength(2)
  expect(s.toasts).toEqual([])
  expect(s.entered).toEqual([])
  expect(s.filled).toEqual(['Upgraded prompt.'])
})

test('a multi-line original is logged in the same row, its line breaks turned into spaces', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Upgraded prompt.'], extra: { 'skip-silent-trigger': true } })
  const text = 'first line of a long prompt\nsecond line of a long prompt\n\nfourth line after a blank one'
  await submit($, text)
  await settle(s)
  expect(s.logs).toHaveLength(1)
  expect(s.logs[0]).toMatch(
    /^Prompt rewrite: sonnet low · \d+(ms|\.\ds) · first line of a long prompt second line of a long prompt fourth line after a blank one$/,
  )
})

test('no log text holds a line break, because the engine draws one log as one row and breaks it into a garbled character', async ($, on) => {
  const s = world($, on, { answers: [QUESTION, 'Upgraded prompt.\nSecond line.'], extra: { 'skip-silent-trigger': true } })
  await submit($, 'first line of a long prompt\nsecond line of a long prompt')
  await settle(s)
  expect(s.logs.length).toBeGreaterThan(0)
  for (const entry of s.logs) expect(entry).not.toMatch(/[\r\n]/)
})

test('a very long original is cut at 2000 characters in the log', async ($, on) => {
  const s = world($, on, { useQuestions: false, answers: ['Upgraded prompt.'], extra: { 'skip-silent-trigger': true } })
  await submit($, 'x'.repeat(5000))
  await settle(s)
  const row = s.logs.find(item => USAGE_LINE.test(item)) ?? ''
  expect(row.length).toBe(2000)
  expect(row.endsWith('x...')).toBe(true)
})

test('the models entry of each call reaches that call and its log line only', async ($, on) => {
  const models = { ask: { model: 'opus', effort: 'high' }, rewrite: { model: 'haiku', effort: 'medium' } }
  const s = world($, on, { extra: { models }, answers: [QUESTION, 'Upgraded prompt.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.ids).toEqual(['opus', 'haiku'])
  expect(s.efforts).toEqual(['high', 'medium'])
  const rows = s.logs.filter(line => USAGE_LINE.test(line))
  expect(rows[0]).toMatch(/^Prompt ask: opus high · /)
  expect(rows[1]).toMatch(/^Prompt rewrite: haiku medium · /)
})

test('the old model keys in the settings reach no call', async ($, on) => {
  const old = { model: 'opus', effort: 'high', 'type-model': 'sonnet', 'type-effort': 'medium' }
  const s = world($, on, { extra: old, answers: [QUESTION, 'Upgraded prompt.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.ids).toEqual(['sonnet', 'sonnet'])
  expect(s.efforts).toEqual(['low', 'low'])
  expect(s.classified.map(c => `${c.model} ${c.effort}`)).toEqual(['haiku low'])
})

test('the prompt types from the classify call reach the rewrite input and the classify log row', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: JSON.stringify({ types: ['research', 'execute'] }), answers: ['Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.classified).toHaveLength(1)
  expect(s.classified[0]?.prompt).toContain(`<prompt>${LONG}</prompt>`)
  expect(s.prompts[0]).toContain('<types>research,execute</types>')
  expect(s.classifyLogs).toEqual(['Prompt classify: haiku low · 0ms · research, execute'])
})

test('a classify call that fails logs failed and the rewrite runs without types', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: null, answers: ['Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.filled).toEqual(['Upgraded prompt.'])
  expect(s.prompts[0]).not.toContain('<types>')
  expect(s.classifyLogs).toEqual(['Prompt classify: haiku low · 0ms · failed'])
})

test('a classify call with no known type logs none and the rewrite runs without types', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: JSON.stringify({ types: ['plan'] }), answers: ['Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.prompts[0]).not.toContain('<types>')
  expect(s.classifyLogs).toEqual(['Prompt classify: haiku low · 0ms · none'])
})

const KOREAN = '첨부한 설계 문서의 내용을 요약해 줄 수 있을까'
const QUESTION_LINE_ONE = '대화 중에 선택지가 생기면 AskUserQuestion 도구로 나에게 권장안과 함께 질문한다.'
const QUESTION_LINE_TWO = '권장 보기는 선택지 목록의 맨 앞에 둔다.'

test('a Korean prompt with a discuss type sends its draft with the two question lines', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: JSON.stringify({ types: ['discuss'] }), answers: ['첨부한 설계 문서를 요약한다.'] })
  await submit($, KOREAN)
  await settle(s)
  expect(s.filled).toEqual(['첨부한 설계 문서를 요약한다.'])
  await submit($, s.filled[0] ?? '')
  const text = s.entered[0] ?? ''
  expect(text).toContain('첨부한 설계 문서를 요약한다.')
  expect(text).toContain(QUESTION_LINE_ONE)
  expect(text).toContain(QUESTION_LINE_TWO)
})

test('a Korean prompt with a research type only gets no question lines', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: JSON.stringify({ types: ['research'] }), answers: ['첨부한 설계 문서를 요약한다.'] })
  await submit($, KOREAN)
  await settle(s)
  expect(s.filled).toEqual(['첨부한 설계 문서를 요약한다.'])
  await submit($, s.filled[0] ?? '')
  expect(s.entered).toHaveLength(1)
  expect(s.entered[0]).toContain('<hard rule>')
  expect(s.entered[0]).not.toContain(QUESTION_LINE_ONE)
})

test('a Korean prompt with an execute type only gets no question lines', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: JSON.stringify({ types: ['execute'] }), answers: ['첨부한 설계 문서를 요약한다.'] })
  await submit($, KOREAN)
  await settle(s)
  expect(s.filled).toEqual(['첨부한 설계 문서를 요약한다.'])
  await submit($, s.filled[0] ?? '')
  expect(s.entered).toHaveLength(1)
  expect(s.entered[0]).toContain('<hard rule>')
  expect(s.entered[0]).not.toContain(QUESTION_LINE_ONE)
})

test('an English prompt with a research type gets no question lines', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: JSON.stringify({ types: ['research'] }), answers: ['Summarise the attached design document.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.filled).toEqual(['Summarise the attached design document.'])
})

const COMMON_LINE = '충분히 조사한다.'
const EXECUTE_LINE = '바꾼 파일을 경로로 나열한다.'
const countOf = (text: string, part: string): number => text.split(part).length - 1

test('a Korean prompt with an execute type only sends its draft with the common and execute lines', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: JSON.stringify({ types: ['execute'] }), answers: ['첨부한 설계 문서를 요약한다.'] })
  await submit($, KOREAN)
  await settle(s)
  expect(s.filled).toEqual(['첨부한 설계 문서를 요약한다.'])
  await submit($, s.filled[0] ?? '')
  const text = s.entered[0] ?? ''
  expect(text).toContain(COMMON_LINE)
  expect(text).toContain(EXECUTE_LINE)
})

test('an English prompt with a research type gets no type lines', async ($, on) => {
  const s = world($, on, { useQuestions: false, extra: { 'skip-silent-trigger': true }, types: JSON.stringify({ types: ['research'] }), answers: ['Summarise the attached design document.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.filled).toEqual(['Summarise the attached design document.'])
})

const FLOW_META_FULL = [
  '너는 프롬프트 엔지니어다.',
  '아래 <source> 는 내가 AI에게 요청하는 내용이다.',
  '<source> 의 요청을 수행하는 프롬프트를 먼저 쓴다.',
  '프롬프트의 작업 부분은 <source> 를 바탕으로 새로 쓴다.',
  '쓴 프롬프트를 채팅에 출력한 후 이 대화에서 그 프롬프트를 실행한다.',
  '<hard rule> 의 규칙은 프롬프트를 쓸 때와 실행할 때 모두 지킨다.',
  '<hard rule> 의 규칙 문장만 쓴 프롬프트에 한 글자도 바꾸지 않고 옮긴다.',
  '쓴 프롬프트에는 <source> 태그와 <hard rule> 태그를 포함하지 않는다.',
].join('\n')

const FLOW_META_SHORT = [
  '너는 프롬프트 엔지니어다.',
  '아래 <source> 는 내가 AI에게 요청하는 내용이다.',
  '<source> 의 요청을 수행하는 프롬프트를 먼저 쓴다.',
  '프롬프트의 작업 부분은 <source> 를 바탕으로 새로 쓴다.',
  '쓴 프롬프트를 채팅에 출력한 후 이 대화에서 그 프롬프트를 실행한다.',
  '쓴 프롬프트에는 <source> 태그를 포함하지 않는다.',
].join('\n')

const FLOW_RESEARCH_RULES = [
  '충분히 조사한다.',
  '결과나 결론을 첫 줄에 쓴다.',
  '확인한 사실과 추측을 구분해 쓴다.',
  '확인하지 못한 내용은 확인하지 못했다고 쓴다.',
  '요청하지 않은 배경 설명을 쓰지 않는다.',
  '이미 있는 할일 목록 중 이번 프롬프트와 관련없는 항목은 삭제한다.',
  '여러 단계의 작업이면 할일 목록을 먼저 생성하고 순서대로 진행한다.',
  '',
  '모든 주장에 근거를 붙인다.',
  '근거는 파일 경로와 줄 번호, 실행 결과, 문서 출처 중 하나로 쓴다.',
  '근거가 없는 내용은 추정이라고 표시한다.',
  '근거끼리 충돌하면 충돌한 사실을 그대로 쓴다.',
].join('\n')

test('a silent run of a Korean prompt with a research type puts the body alone in the prompt box and sends the whole assembled message', async ($, on) => {
  const typed = `${KOREAN} +++`
  const s = world($, on, {
    useQuestions: false,
    types: JSON.stringify({ types: ['research'] }),
    answers: ['첨부한 설계 문서를 요약한다.'],
    box: typed,
  })
  await submit($, typed)
  await settle(s)
  expect(s.filled).toEqual(['첨부한 설계 문서를 요약한다.'])
  expect(s.entered).toEqual([])
  await submit($, '첨부한 설계 문서를 요약한다.')
  expect(s.entered).toEqual([
    `${FLOW_META_FULL}\n\n<hard rule>\n${FLOW_RESEARCH_RULES}\n</hard rule>\n\n<source>\n첨부한 설계 문서를 요약한다.\n</source>`,
  ])
})

test('a silent run of a Korean prompt with no known type puts the body alone in the prompt box and sends the short instruction and the source', async ($, on) => {
  const typed = `${KOREAN} +++`
  const s = world($, on, { useQuestions: false, answers: ['첨부한 설계 문서를 요약한다.'], box: typed })
  await submit($, typed)
  await settle(s)
  expect(s.filled).toEqual(['첨부한 설계 문서를 요약한다.'])
  await submit($, '첨부한 설계 문서를 요약한다.')
  expect(s.entered).toEqual([`${FLOW_META_SHORT}\n\n<source>\n첨부한 설계 문서를 요약한다.\n</source>`])
})

test('a silent run of an English prompt with a research type puts the rewritten draft alone in the prompt box', async ($, on) => {
  const typed = `${LONG} +++`
  const s = world($, on, {
    useQuestions: false,
    types: JSON.stringify({ types: ['research'] }),
    answers: ['Summarise the attached design document.'],
    box: typed,
  })
  await submit($, typed)
  await settle(s)
  expect(s.filled).toEqual(['Summarise the attached design document.'])
})

test('the classify call uses haiku low by default whatever model the upgrade calls use', async ($, on) => {
  const models = { ask: { model: 'opus', effort: 'high' }, rewrite: { model: 'opus', effort: 'high' } }
  const s = world($, on, { extra: { models }, answers: [QUESTION, 'Upgraded prompt.'], box: TRIGGERED })
  await submit($, TRIGGERED)
  await settle(s)
  expect(s.classified.map(c => `${c.model} ${c.effort}`)).toEqual(['haiku low'])
  expect(s.ids).toEqual(['opus', 'opus'])
})

test('models.classify from the settings reaches the classify call only', async ($, on) => {
  const models = { classify: { model: 'sonnet', effort: 'medium' } }
  const s = world($, on, { useQuestions: false, extra: { models, 'skip-silent-trigger': true }, answers: ['Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.classified.map(c => `${c.model} ${c.effort}`)).toEqual(['sonnet medium'])
  expect(s.ids).toEqual(['sonnet'])
  expect(s.efforts).toEqual(['low'])
  expect(s.classifyLogs[0]).toMatch(/^Prompt classify: sonnet medium · /)
})

test('a model or effort that is not valid falls back to sonnet and low', async ($, on) => {
  const models = { ask: { model: '  ', effort: 'ultra' }, rewrite: { model: 5, effort: ['high'] } }
  const s = world($, on, { extra: { models, 'skip-silent-trigger': true }, answers: [JSON.stringify({ questions: [] }), 'Upgraded prompt.'] })
  await submit($, LONG)
  await settle(s)
  expect(s.ids).toEqual(['sonnet', 'sonnet'])
  expect(s.efforts).toEqual(['low', 'low'])
})

test('a Haiku call that fails still logs its line', async ($, on) => {
  const s = world($, on, { extra: { 'skip-silent-trigger': true }, answers: [null, null] })
  await submit($, LONG)
  await settle(s)
  expect(s.logs.filter(line => USAGE_LINE.test(line)).length).toBeGreaterThan(0)
})

const BODY = '첨부한 설계 문서를 요약한다.'
const shortWrapped = (body: string): string => `${FLOW_META_SHORT}\n\n<source>\n${body}\n</source>`
const DIFFERENT = '오늘 점심 메뉴를 추천해 주면 좋겠다 그리고 날씨도 알려 줘'

const filledRun = async ($: Engine, on: On) => {
  const typed = `${KOREAN} +++`
  const s = world($, on, { useQuestions: false, answers: [BODY], box: typed })
  await submit($, typed)
  await settle(s)

  return s
}

test('a Korean draft in the prompt box says the instruction and the rules are added when it is sent', async ($, on) => {
  const s = await filledRun($, on)
  expect(s.filled).toEqual([BODY])
  expect(s.toasts.join(' ')).toMatch(/added when you send/)
})

const SHORT_LABEL = '[+9 lines added on send]\n'
const labelAt = () => [{ start: 0, end: 0, virtualText: SHORT_LABEL, dimColor: true }]
type EditResult = { text: string; decorations?: unknown[] }
const editAt = ($: Engine, text: string, start: number, end: number, inputText: string) =>
  ($.prompt as unknown as { edit: (e: unknown) => Promise<EditResult> }).edit({ text, cursor: end, start, end, inputText })

test('a Korean draft is filled with a dim label line above the text that counts the lines added on send', async ($, on) => {
  const s = await filledRun($, on)
  expect(s.filled).toEqual([BODY])
  expect(s.decorations).toEqual([labelAt()])
})

test('the label stays on the draft while it is edited and goes when the text is another prompt or empty', async ($, on) => {
  await filledRun($, on)
  const added = await editAt($, BODY, BODY.length, BODY.length, ' 표')
  expect(added.text).toBe(`${BODY} 표`)
  expect(added.decorations).toEqual(labelAt())
  const changed = await editAt($, BODY, 6, 8, '내용')
  expect(changed.decorations).toEqual(labelAt())
  const other = await editAt($, BODY, 0, BODY.length, DIFFERENT)
  expect(other.decorations ?? []).toEqual([])
  const empty = await editAt($, BODY, 0, BODY.length, '')
  expect(empty.decorations ?? []).toEqual([])
})

test('no label after the pass is spent and none on a draft with nothing aside', async ($, on) => {
  const s = await filledRun($, on)
  await submit($, BODY)
  expect(s.entered).toEqual([shortWrapped(BODY)])
  const spent = await editAt($, BODY, BODY.length, BODY.length, ' 표')
  expect(spent.decorations ?? []).toEqual([])
})

test('an English draft is filled with no label and its edits get none', async ($, on) => {
  const typed = `${LONG} +++`
  const s = world($, on, { useQuestions: false, answers: ['Summarise the attached design document.'], box: typed })
  await submit($, typed)
  await settle(s)
  expect(s.decorations).toEqual([undefined])
  const edited = await editAt($, 'Summarise the attached design document.', 0, 0, 'x')
  expect(edited.decorations ?? []).toEqual([])
})

test('an English draft keeps nothing aside, says nothing and is sent as it is', async ($, on) => {
  const typed = `${LONG} +++`
  const s = world($, on, { useQuestions: false, answers: ['Summarise the attached design document.'], box: typed })
  await submit($, typed)
  await settle(s)
  expect(s.toasts).toEqual([])
  await submit($, 'Summarise the attached design document.')
  expect(s.entered).toEqual(['Summarise the attached design document.'])
})

test('the filled draft is sent with the instruction and the rules even after the time limit, and the pass is spent', async ($, on) => {
  const s = await filledRun($, on)
  await s.clock?.advance(AFTER_PASS)
  await submit($, `  ${BODY}  `)
  expect(s.entered).toEqual([shortWrapped(BODY)])
  await submit($, BODY)
  expect(s.entered).toEqual([shortWrapped(BODY), BODY])
})

test('a draft with text added is sent with the instruction and the rules', async ($, on) => {
  const s = await filledRun($, on)
  await submit($, `${BODY}\n표로 정리한다.`)
  expect(s.entered).toEqual([shortWrapped(`${BODY}\n표로 정리한다.`)])
  expect(s.toasts.join(' ')).not.toMatch(/differs from the draft/)
})

test('a draft with a few characters changed is sent with the instruction and the rules', async ($, on) => {
  const s = await filledRun($, on)
  await submit($, '첨부한 설계 문서를 정리한다.')
  expect(s.entered).toEqual([shortWrapped('첨부한 설계 문서를 정리한다.')])
})

test('a text that differs from the draft is sent as it is, says so, and spends the pass', async ($, on) => {
  const s = await filledRun($, on)
  await submit($, DIFFERENT)
  expect(s.entered).toEqual([DIFFERENT])
  expect(s.toasts.join(' ')).toMatch(/differs from the draft/)
  await submit($, BODY)
  expect(s.entered).toEqual([DIFFERENT, BODY])
})

test('the off trigger sends the draft as it is, and the wrapper is gone for the next submit', async ($, on) => {
  const s = await filledRun($, on)
  await submit($, `${BODY} ---`)
  expect(s.entered).toEqual([BODY])
  await submit($, BODY)
  expect(s.entered).toEqual([BODY, BODY])
  expect(s.toasts.join(' ')).not.toMatch(/differs from the draft/)
})

const NEVER_WRAPPED: Array<[string, string, Record<string, unknown>]> = [
  ['a peer message', `${BODY}\n표로 정리한다.`, { origin: { kind: 'peer' } }],
  ['a slash command', '/compact the conversation please', {}],
  ['a shell command', '!ls -la the current folder now', {}],
  ['a prompt with an attachment', `${BODY}\n표로 정리한다.`, { attachments: [{ type: 'image' }] }],
]

for (const [name, text, extra] of NEVER_WRAPPED) {
  test(`${name} inside the time limit is never wrapped`, async ($, on) => {
    const s = await filledRun($, on)
    await submit($, text, extra)
    expect(s.entered).toEqual([text])
    expect(s.toasts.join(' ')).not.toMatch(/differs from the draft/)
  })
}

test('a pasted message that already holds the wrapper is sent as it is and says the wrapper was left out', async ($, on) => {
  const s = await filledRun($, on)
  const pasted = `<pasted_content id="1">${shortWrapped(BODY)}</pasted_content id="1">`
  await submit($, pasted)
  expect(s.entered).toEqual([pasted])
  expect(s.toasts.join(' ')).toMatch(/differs from the draft/)
})

test('a draft parked on the clipboard because the person typed meanwhile is the whole assembled message', async ($, on) => {
  const typed = `${KOREAN} +++`
  const s = world($, on, { useQuestions: false, answers: [BODY], box: ['', 'something typed later'] })
  await submit($, typed)
  await settle(s)
  expect(s.filled).toEqual([])
  expect(s.copied).toEqual([shortWrapped(BODY)])
  expect(s.toasts.join(' ')).toMatch(/clipboard/)
})

test('the original a failed Haiku call leaves in the box is sent with no wrapper and no notice', async ($, on) => {
  const typed = `${KOREAN} +++`
  const s = world($, on, { useQuestions: false, answers: [null], box: typed })
  await submit($, typed)
  await settle(s)
  expect(s.filled).toEqual([KOREAN])
  expect(s.toasts.join(' ')).not.toMatch(/added when you send/)
  await submit($, KOREAN)
  expect(s.entered).toEqual([KOREAN])
})
