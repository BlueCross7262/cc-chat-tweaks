import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { CLASSIFY_SYSTEM } from './upgrade-prompts'

const PLUGIN = 'cc-chat-tweaks'
const LONG = 'please summarise the attached design document for me'
const DRAFT = '설계 문서를 요약해 줘.'
const USAGE = { input_tokens: 1, output_tokens: 1 }
const composer = { kind: 'composer' } as const

type Box = { text: string; clock: ReturnType<typeof mock.clock> }

const world = ($: Engine, on: On, options: { isOn?: boolean; isUpgradeOn?: boolean } = {}): Box => {
  const box: Box = { text: '', clock: mock.clock(on, { now: 1000 }) }
  mock.store(on, {})
  const prompt = {
    'char-count': { use: options.isOn ?? true },
    'prompt-upgrade': { use: options.isUpgradeOn ?? false, 'use-questions': false, 'skip-silent-trigger': true },
  }
  on('settings.read', (_$, e) => ({ value: (e as { source?: string }).source === 'user' ? { ccChatTweaks: { prompt } } : {} }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('prompt.edit', (_$, e) => {
    const edit = e as { text: string; start: number; end: number; inputText: string }
    box.text = edit.text.slice(0, edit.start) + edit.inputText + edit.text.slice(edit.end)
    return { text: box.text, cursor: edit.start + edit.inputText.length } as never
  })
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }) as never)
  on('prompt.fill', (_$, e) => {
    box.text = (e as { text: string }).text
    return { isFilled: true } as never
  })
  on('prompt.submit', (_$, e) => {
    box.text = ''
    return { text: (e as { text: string }).text } as never
  })
  on('model.complete', (_$, e) => {
    const call = e as { system?: string }
    const text = call.system === CLASSIFY_SYSTEM ? JSON.stringify({ types: [] }) : DRAFT
    return { value: { isAnswered: true, text, usage: USAGE } } as never
  })
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.render', (_$, e) => ({
    type: 'Text',
    props: {},
    children: [((e as { props: { modes: readonly string[] } }).props.modes ?? []).join(' & ')],
  }) as never)

  return box
}

type EditCall = { origin: typeof composer; text: string; cursor: number; start: number; end: number; inputText: string }

const edit = ($: Engine, e: EditCall) => ($.prompt as unknown as { edit: (e: EditCall) => Promise<unknown> }).edit(e)

const type = ($: Engine, text: string, inputText: string) =>
  edit($, { origin: composer, text, cursor: text.length, start: text.length, end: text.length, inputText })

const modesLine = async ($: Engine): Promise<string> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', requestId: 'modes', props: { modes: ['focus'] } })
  const line = (await ui.findAll({ type: 'Text' })).map(item => item.text).join('')
  await ui.unmount()

  return line
}

test('typed text adds its character count to the mode labels', async ($, on) => {
  world($, on)
  await type($, '', '안녕')
  expect(await modesLine($)).toBe('focus & 2')
  await type($, '안녕', '👨‍👩‍👧')
  expect(await modesLine($)).toBe('focus & 3')
})

test('a deletion lowers the count and an empty box shows no label', async ($, on) => {
  world($, on)
  await type($, '', 'abc')
  await edit($, { origin: composer, text: 'abc', cursor: 3, start: 2, end: 3, inputText: '' })
  expect(await modesLine($)).toBe('focus & 2')
  await edit($, { origin: composer, text: 'ab', cursor: 2, start: 0, end: 2, inputText: '' })
  expect(await modesLine($)).toBe('focus')
})

test('the labels stay as they are while the switch is off', async ($, on) => {
  world($, on, { isOn: false })
  await type($, '', '안녕하세요')
  expect(await modesLine($)).toBe('focus')
})

test('text another plugin fills in is counted', async ($, on) => {
  world($, on)
  await $.prompt.fill({ text: 'hello', mode: 'replace', origin: { kind: 'plugin', name: 'other' } } as never)
  expect(await modesLine($)).toBe('focus & 5')
})

test('sending the prompt clears the count', async ($, on) => {
  world($, on)
  await type($, '', 'hi')
  await $.prompt.submit({ text: 'hi', wait: false, origin: composer })
  expect(await modesLine($)).toBe('focus')
})

test('the draft the prompt upgrade puts in the box is counted', async ($, on) => {
  const box = world($, on, { isUpgradeOn: true })
  await type($, '', LONG)
  await $.prompt.submit({ text: LONG, wait: false, origin: composer })
  await box.clock.advance(0)
  await box.clock.advance(300)
  expect(box.text).toBe(DRAFT)
  expect(await modesLine($)).toBe(`focus & ${[...new Intl.Segmenter().segment(DRAFT)].length}`)
})
