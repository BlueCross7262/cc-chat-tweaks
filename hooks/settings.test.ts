import { expect, test } from 'claude-code/testing'

import {
  describeFlags,
  effortOf,
  FLAG_GROUPS,
  flagsOf,
  isFlagOn,
  minLengthOf,
  modelOf,
  silentTriggerOf,
  withMissingDefaults,
  type FlagKey,
} from './settings'

const minLength = (value: unknown) => ({ ccChatTweaks: { prompt: { 'min-length': value } } })

test('min-length comes from the first source with a valid whole number from 1 to 10000', () => {
  expect(minLengthOf([])).toBeUndefined()
  expect(minLengthOf([minLength(40)])).toBe(40)
  expect(minLengthOf([minLength('40'), minLength(0), minLength(2.5), minLength(10001)])).toBeUndefined()
  expect(minLengthOf([minLength(0), minLength(25), minLength(40)])).toBe(25)
  expect(minLengthOf([{ ccChatTweaks: 'x' }, null, minLength(7)])).toBe(7)
})

const set = (key: FlagKey, value: unknown) => ({ ccChatTweaks: { [FLAG_GROUPS[key]]: { [key]: value } } })

const trigger = (value: unknown) => ({ ccChatTweaks: { prompt: { 'silent-trigger': value } } })

test('silent-trigger is the first trimmed string of 1 to 32 characters', () => {
  expect(silentTriggerOf([])).toBeUndefined()
  expect(silentTriggerOf([trigger('  >>  ')])).toBe('>>')
  expect(silentTriggerOf([trigger('   ')])).toBeUndefined()
  expect(silentTriggerOf([trigger(5)])).toBeUndefined()
  expect(silentTriggerOf([trigger('x'.repeat(33))])).toBeUndefined()
  expect(silentTriggerOf([trigger(''), trigger('##')])).toBe('##')
})

const prompt = (key: string, value: unknown) => ({ ccChatTweaks: { prompt: { [key]: value } } })

test('model is the first trimmed string of 1 to 100 characters', () => {
  expect(modelOf([])).toBeUndefined()
  expect(modelOf([prompt('model', '  sonnet  ')])).toBe('sonnet')
  expect(modelOf([prompt('model', '   '), prompt('model', 5), prompt('model', 'x'.repeat(101)), prompt('model', 'claude-haiku-5-5')])).toBe('claude-haiku-5-5')
  expect(modelOf([{ ccChatTweaks: { chat: { model: 'opus' } } }])).toBeUndefined()
})

test('effort is the first value among low, medium, high, xhigh and max', () => {
  expect(effortOf([])).toBeUndefined()
  expect(effortOf([prompt('effort', 'high')])).toBe('high')
  expect(effortOf([prompt('effort', ' max ')])).toBe('max')
  expect(effortOf([prompt('effort', 'LOW'), prompt('effort', 3), prompt('effort', 'ultra'), prompt('effort', 'xhigh')])).toBe('xhigh')
})

test('every feature switch is off and the option is on when no source sets it', () => {
  expect(isFlagOn([], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([], 'use-edit-summary')).toBe(false)
  expect(isFlagOn([], 'use-prompt-upgrade')).toBe(false)
  expect(isFlagOn([], 'use-questions')).toBe(true)
  expect(isFlagOn([], 'use-silent-upgrade')).toBe(true)
  expect(isFlagOn([{}, { ccChatTweaks: {} }, { ccChatTweaks: { chat: {} } }], 'use-tool-fold')).toBe(false)
})

test('the prompt switches live under ccChatTweaks.prompt and are not read from ccChatTweaks.chat', () => {
  expect(FLAG_GROUPS['use-prompt-upgrade']).toBe('prompt')
  expect(FLAG_GROUPS['use-questions']).toBe('prompt')
  expect(isFlagOn([{ ccChatTweaks: { prompt: { 'use-prompt-upgrade': true } } }], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-prompt-upgrade': true } } }], 'use-prompt-upgrade')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-questions': false } } }], 'use-questions')).toBe(true)
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
  expect(flagsOf([set('use-edit-summary', true), set('use-prompt-upgrade', true)])).toEqual({
    'use-tool-fold': false,
    'use-edit-summary': true,
    'use-prompt-upgrade': true,
    'use-questions': true,
    'use-silent-upgrade': true,
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

  expect(added).toEqual(['use-edit-summary', 'use-prompt-upgrade', 'use-questions', 'use-silent-upgrade', 'min-length', 'silent-trigger', 'model', 'effort'])
  expect(settings).toEqual({
    theme: 'dark',
    ccChatTweaks: {
      chat: { 'use-tool-fold': true, 'use-edit-summary': false },
      prompt: {
        'use-prompt-upgrade': false,
        'use-questions': true,
        'use-silent-upgrade': true,
        'min-length': 10,
        'silent-trigger': '+++',
        model: 'haiku',
        effort: 'low',
      },
      other: 1,
    },
  })
  expect(existing.ccChatTweaks.chat).toEqual({ 'use-tool-fold': true })
})

test('builds the whole section for an empty or malformed file', () => {
  expect(withMissingDefaults({}).added).toHaveLength(9)
  expect(withMissingDefaults(null).added).toHaveLength(9)
  expect(withMissingDefaults({ ccChatTweaks: 'x' }).settings).toEqual({
    ccChatTweaks: {
      chat: { 'use-tool-fold': false, 'use-edit-summary': false },
      prompt: {
        'use-prompt-upgrade': false,
        'use-questions': true,
        'use-silent-upgrade': true,
        'min-length': 10,
        'silent-trigger': '+++',
        model: 'haiku',
        effort: 'low',
      },
    },
  })
})

test('reports nothing to add when every switch is present', () => {
  const full = {
    ccChatTweaks: {
      chat: { 'use-tool-fold': true, 'use-edit-summary': false },
      prompt: {
        'use-prompt-upgrade': false,
        'use-questions': true,
        'use-silent-upgrade': false,
        'min-length': 25,
        'silent-trigger': '##',
        model: 'sonnet',
        effort: 'high',
      },
    },
  }

  expect(withMissingDefaults(full).added).toEqual([])
  expect(withMissingDefaults(full).settings).toEqual(full)
})
