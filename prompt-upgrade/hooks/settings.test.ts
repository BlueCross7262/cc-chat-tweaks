import { expect, test } from 'claude-code/testing'

import { describeFlags, flagsOf, isFlagOn } from './settings'

const set = (key: string, value: unknown) => ({ promptUpgrade: { chat: { [key]: value } } })

test('defaults: the upgrade is off and the questions are on', () => {
  expect(flagsOf([])).toEqual({ 'use-prompt-upgrade': false, 'use-questions': true })
  expect(flagsOf([{}, { promptUpgrade: {} }, { promptUpgrade: { chat: {} } }])).toEqual({
    'use-prompt-upgrade': false,
    'use-questions': true,
  })
})

test('a boolean in a source overrides the default in both directions', () => {
  expect(isFlagOn([set('use-prompt-upgrade', true)], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([set('use-questions', false)], 'use-questions')).toBe(false)
})

test('ignores a value that is not a boolean', () => {
  expect(isFlagOn([set('use-prompt-upgrade', 'true')], 'use-prompt-upgrade')).toBe(false)
  expect(isFlagOn([set('use-questions', 0)], 'use-questions')).toBe(true)
  expect(isFlagOn([set('use-questions', null)], 'use-questions')).toBe(true)
})

test('takes the first source that holds a boolean, highest precedence first', () => {
  expect(isFlagOn([set('use-prompt-upgrade', false), set('use-prompt-upgrade', true)], 'use-prompt-upgrade')).toBe(false)
  expect(isFlagOn([{}, set('use-prompt-upgrade', true)], 'use-prompt-upgrade')).toBe(true)
})

test('a non-boolean in a higher source does not hide a boolean below it', () => {
  expect(isFlagOn([set('use-prompt-upgrade', 'x'), set('use-prompt-upgrade', true)], 'use-prompt-upgrade')).toBe(true)
})

test('keys outside the namespace are ignored', () => {
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-prompt-upgrade': true } } }], 'use-prompt-upgrade')).toBe(false)
})

test('describes the value and the source of every switch', () => {
  const named = [
    ['policy', {}],
    ['local', set('use-prompt-upgrade', true)],
    ['user', set('use-prompt-upgrade', false)],
  ] as const

  expect(describeFlags(named)).toEqual([
    { key: 'use-prompt-upgrade', value: true, from: 'local' },
    { key: 'use-questions', value: true, from: 'default' },
  ])
})
