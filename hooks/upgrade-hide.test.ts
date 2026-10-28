import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { wrapText } from './upgrade-logic'

const PLUGIN = 'cc-chat-tweaks'
const SOURCE = '로그인 버그를 고친다.'
const composer = { kind: 'composer' } as const
const other = { kind: 'plugin', name: 'other' } as const

const world = (on: On): void => {
  mock.store(on, {})
  on('settings.read', () => ({ value: {} }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('ui.render', (_$, e) => ({
    type: 'Text',
    props: {},
    children: [(e as { props: { text: string } }).props.text],
  }) as never)
}

const rowText = async ($: Engine, text: string, origin: object): Promise<string> => {
  const props = { text, origin, isExpanded: false } as never
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'row', props })
  const drawn = (await ui.findAll({ type: 'Text' })).map(item => item.text).join('')
  await ui.unmount()

  return drawn
}

test('a prompt row the person sent shows only the source of the wrapper', async ($, on) => {
  world(on)
  expect(await rowText($, wrapText(SOURCE, { types: ['execute'] }), composer)).toBe(SOURCE)
  expect(await rowText($, wrapText(SOURCE, { types: [] }), composer)).toBe(SOURCE)
})

test('a row that holds no wrapper is drawn as it is', async ($, on) => {
  world(on)
  expect(await rowText($, SOURCE, composer)).toBe(SOURCE)
})

test('a row from another sender keeps its wrapper', async ($, on) => {
  world(on)
  const text = wrapText(SOURCE, { types: ['execute'] })
  expect(await rowText($, text, other)).toBe(text)
})
