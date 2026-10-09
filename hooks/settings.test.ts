import { expect, test } from 'claude-code/testing'

import { describeFlags, flagsOf, isFlagOn, withMissingDefaults } from './settings'

const set = (key: string, value: unknown) => ({ ccChatTweaks: { chat: { [key]: value } } })

test('every switch is off when no source sets it', () => {
  expect(isFlagOn([], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([], 'use-edit-summary')).toBe(false)
  expect(isFlagOn([{}, { ccChatTweaks: {} }, { ccChatTweaks: { chat: {} } }], 'use-tool-fold')).toBe(false)
})

test('a boolean in a source overrides the default in both directions', () => {
  expect(isFlagOn([set('use-edit-summary', true)], 'use-edit-summary')).toBe(true)
  expect(isFlagOn([set('use-tool-fold', false)], 'use-tool-fold')).toBe(false)
})

test('ignores a value that is not a boolean', () => {
  expect(isFlagOn([set('use-edit-summary', 'true')], 'use-edit-summary')).toBe(false)
  expect(isFlagOn([set('use-tool-fold', 1)], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([set('use-tool-fold', null)], 'use-tool-fold')).toBe(false)
})

test('takes the first source that holds a boolean, highest precedence first', () => {
  expect(isFlagOn([set('use-tool-fold', false), set('use-tool-fold', true)], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([{}, set('use-tool-fold', true), set('use-tool-fold', false)], 'use-tool-fold')).toBe(true)
  expect(isFlagOn([set('use-tool-fold', 'x'), set('use-tool-fold', true)], 'use-tool-fold')).toBe(true)
})

test('ignores a malformed namespace', () => {
  expect(isFlagOn([{ ccChatTweaks: 'on' }, { ccChatTweaks: { chat: ['use-tool-fold'] } }, null], 'use-tool-fold')).toBe(false)
})

test('reads every flag at once', () => {
  expect(flagsOf([set('use-edit-summary', true)])).toEqual({
    'use-tool-fold': false,
    'use-edit-summary': true,
  })
})

test('names the source each switch comes from', () => {
  const report = describeFlags([
    ['policy', {}],
    ['local', set('use-tool-fold', true)],
    ['user', set('use-tool-fold', false)],
  ])

  expect(report.find(item => item.key === 'use-tool-fold')).toEqual({ key: 'use-tool-fold', value: true, from: 'local' })
  expect(report.find(item => item.key === 'use-edit-summary')).toEqual({ key: 'use-edit-summary', value: false, from: 'default' })
})

test('adds only the missing switches with their default and keeps everything else', () => {
  const existing = { theme: 'dark', ccChatTweaks: { chat: { 'use-tool-fold': true }, other: 1 } }
  const { settings, added } = withMissingDefaults(existing)

  expect(added).toEqual(['use-edit-summary'])
  expect(settings).toEqual({
    theme: 'dark',
    ccChatTweaks: {
      chat: { 'use-tool-fold': true, 'use-edit-summary': false },
      other: 1,
    },
  })
  expect(existing.ccChatTweaks.chat).toEqual({ 'use-tool-fold': true })
})

test('builds the whole section for an empty or malformed file', () => {
  expect(withMissingDefaults({}).added).toHaveLength(2)
  expect(withMissingDefaults(null).added).toHaveLength(2)
  expect(withMissingDefaults({ ccChatTweaks: 'x' }).settings).toEqual({
    ccChatTweaks: { chat: { 'use-tool-fold': false, 'use-edit-summary': false } },
  })
})

test('reports nothing to add when every switch is present', () => {
  const full = { ccChatTweaks: { chat: { 'use-tool-fold': true, 'use-edit-summary': false } } }

  expect(withMissingDefaults(full).added).toEqual([])
})
