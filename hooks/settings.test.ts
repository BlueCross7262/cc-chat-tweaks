import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_UNFOLDED_TOOLS,
  describeExtras,
  describeFlags,
  effortOf,
  FLAG_PATHS,
  flagsOf,
  isFlagOn,
  labelOf,
  minLengthOf,
  modelOf,
  propOf,
  silentTriggersOf,
  unfoldedToolsOf,
  withMissingDefaults,
  type FlagKey,
} from './settings'

const up = (group: Record<string, unknown>) => ({ ccChatTweaks: { prompt: { 'prompt-upgrade': group } } })

const minLength = (value: unknown) => up({ 'min-length': value })

test('min-length comes from the first source with a valid whole number from 1 to 10000', () => {
  expect(minLengthOf([])).toBeUndefined()
  expect(minLengthOf([minLength(40)])).toBe(40)
  expect(minLengthOf([minLength('40'), minLength(0), minLength(2.5), minLength(10001)])).toBeUndefined()
  expect(minLengthOf([minLength(0), minLength(25), minLength(40)])).toBe(25)
  expect(minLengthOf([{ ccChatTweaks: 'x' }, null, minLength(7)])).toBe(7)
})

const nest = (path: readonly string[], leaf: Record<string, unknown>): Record<string, unknown> =>
  path.reduceRight<Record<string, unknown>>((inner, name) => ({ [name]: inner }), leaf)

const set = (key: FlagKey, value: unknown) => ({ ccChatTweaks: nest(FLAG_PATHS[key], { [propOf(key)]: value }) })

const triggers = (value: unknown) => up({ 'silent-triggers': value })

test('silent-triggers is the first array with a valid entry, each entry a trimmed string of 1 to 32 characters', () => {
  expect(silentTriggersOf([])).toBeUndefined()
  expect(silentTriggersOf([triggers(['  >>  ', '+++'])])).toEqual(['>>', '+++'])
  expect(silentTriggersOf([triggers(['   ', 5, null, 'x'.repeat(33), '##'])])).toEqual(['##'])
  expect(silentTriggersOf([triggers(['>>', '>>', ' >> '])])).toEqual(['>>'])
  expect(silentTriggersOf([triggers([])])).toBeUndefined()
  expect(silentTriggersOf([triggers(['  ', 5])])).toBeUndefined()
  expect(silentTriggersOf([triggers('+++')])).toBeUndefined()
  expect(silentTriggersOf([triggers(5)])).toBeUndefined()
  expect(silentTriggersOf([triggers([]), triggers(['##'])])).toEqual(['##'])
  expect(silentTriggersOf([up({ 'silent-trigger': '+++' })])).toBeUndefined()
})

test('silent-triggers keeps at most 10 entries', () => {
  const many = Array.from({ length: 15 }, (_, i) => `t${i}`)

  expect(silentTriggersOf([triggers(many)])).toEqual(many.slice(0, 10))
})

const prompt = (key: string, value: unknown) => up({ [key]: value })

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
  expect(isFlagOn([], 'skip-silent-trigger')).toBe(false)
  expect(isFlagOn([up({ 'skip-silent-trigger': true })], 'skip-silent-trigger')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'skip-silent-trigger': true } } }], 'skip-silent-trigger')).toBe(false)
  expect(isFlagOn([{}, { ccChatTweaks: {} }, { ccChatTweaks: { chat: {} } }], 'use-tool-fold')).toBe(false)
})

test('the prompt upgrade keys live under ccChatTweaks.prompt.prompt-upgrade and are read from nowhere else', () => {
  for (const key of ['use-prompt-upgrade', 'use-questions', 'use-silent-upgrade', 'skip-silent-trigger'] as const) {
    expect(FLAG_PATHS[key]).toEqual(['prompt', 'prompt-upgrade'])
  }
  expect(FLAG_PATHS['use-tool-fold']).toEqual(['chat', 'tool-fold'])
  expect(propOf('use-tool-fold')).toBe('use')
  expect(propOf('use-edit-summary')).toBe('use-edit-summary')
  expect(FLAG_PATHS['use-edit-summary']).toEqual(['chat'])
  expect(isFlagOn([up({ 'use-prompt-upgrade': true })], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { prompt: { 'use-prompt-upgrade': true } } }], 'use-prompt-upgrade')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { 'prompt-upgrade': { 'use-prompt-upgrade': true } } }], 'use-prompt-upgrade')).toBe(false)
  expect(minLengthOf([{ ccChatTweaks: { prompt: { 'min-length': 40 } } }])).toBeUndefined()
  expect(modelOf([{ ccChatTweaks: { prompt: { model: 'sonnet' } } }])).toBeUndefined()
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-prompt-upgrade': true } } }], 'use-prompt-upgrade')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-questions': false } } }], 'use-questions')).toBe(true)
})

test('tool folding is switched by ccChatTweaks.chat.tool-fold.use and by nothing else', () => {
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'tool-fold': { use: true } } } }], 'use-tool-fold')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-tool-fold': true } } }], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { use: true } } }], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { 'tool-fold': { use: true } } }], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'tool-fold': { 'use-tool-fold': true } } } }], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'tool-fold': { use: 'yes' } } } }], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-edit-summary': true } } }], 'use-edit-summary')).toBe(true)
})

test('the label of a key is the path of its setting under ccChatTweaks', () => {
  expect(labelOf('use-tool-fold')).toBe('chat.tool-fold.use')
  expect(labelOf('use-edit-summary')).toBe('chat.use-edit-summary')
  expect(labelOf('unfolded-tools')).toBe('chat.tool-fold.unfolded-tools')
  expect(labelOf('use-prompt-upgrade')).toBe('prompt.prompt-upgrade.use-prompt-upgrade')
  expect(labelOf('min-length')).toBe('prompt.prompt-upgrade.min-length')
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
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'tool-fold': ['use'] } } }], 'use-tool-fold')).toBe(false)
})

test('reads every flag at once', () => {
  expect(flagsOf([set('use-edit-summary', true), set('use-prompt-upgrade', true)])).toEqual({
    'use-tool-fold': false,
    'use-edit-summary': true,
    'use-prompt-upgrade': true,
    'use-questions': true,
    'use-silent-upgrade': true,
    'skip-silent-trigger': false,
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
  const existing = {
    theme: 'dark',
    ccChatTweaks: { chat: { 'tool-fold': { use: true } }, prompt: { later: { 'a-future-key': 1 } }, other: 1 },
  }
  const { settings, added } = withMissingDefaults(existing)

  expect(added).toEqual(['use-edit-summary', 'use-prompt-upgrade', 'use-questions', 'use-silent-upgrade', 'skip-silent-trigger', 'min-length', 'silent-triggers', 'model', 'effort', 'unfolded-tools'])
  expect(settings).toEqual({
    theme: 'dark',
    ccChatTweaks: {
      chat: {
        'tool-fold': { use: true, 'unfolded-tools': ['AskUserQuestion', 'Skill', 'Agent'] },
        'use-edit-summary': false,
      },
      prompt: {
        later: { 'a-future-key': 1 },
        'prompt-upgrade': {
          'use-prompt-upgrade': false,
          'use-questions': true,
          'use-silent-upgrade': true,
          'skip-silent-trigger': false,
          'min-length': 10,
          'silent-triggers': ['+++'],
          model: 'haiku',
          effort: 'low',
        },
      },
      other: 1,
    },
  })
  expect(existing.ccChatTweaks.chat).toEqual({ 'tool-fold': { use: true } })
  expect(existing.ccChatTweaks.prompt).toEqual({ later: { 'a-future-key': 1 } })
})

test('builds the whole section for an empty or malformed file', () => {
  expect(withMissingDefaults({}).added).toHaveLength(11)
  expect(withMissingDefaults(null).added).toHaveLength(11)
  expect(withMissingDefaults({ ccChatTweaks: 'x' }).settings).toEqual({
    ccChatTweaks: {
      chat: {
        'tool-fold': { use: false, 'unfolded-tools': ['AskUserQuestion', 'Skill', 'Agent'] },
        'use-edit-summary': false,
      },
      prompt: {
        'prompt-upgrade': {
          'use-prompt-upgrade': false,
          'use-questions': true,
          'use-silent-upgrade': true,
          'skip-silent-trigger': false,
          'min-length': 10,
          'silent-triggers': ['+++'],
          model: 'haiku',
          effort: 'low',
        },
      },
    },
  })
})

test('the old location is left alone and its keys are not read', () => {
  const old = { ccChatTweaks: { prompt: { 'use-prompt-upgrade': true, model: 'sonnet' } } }
  const { settings, added } = withMissingDefaults(old)
  const prompt = (settings.ccChatTweaks as { prompt: Record<string, unknown> }).prompt

  expect(added).toContain('use-prompt-upgrade')
  expect(prompt['use-prompt-upgrade']).toBe(true)
  expect(prompt.model).toBe('sonnet')
  expect((prompt['prompt-upgrade'] as Record<string, unknown>)['use-prompt-upgrade']).toBe(false)
  expect(isFlagOn([settings], 'use-prompt-upgrade')).toBe(false)
})

test('the default trigger list written to a file is a copy, so editing it leaves the default alone', () => {
  type Written = { ccChatTweaks: { prompt: { 'prompt-upgrade': { 'silent-triggers': string[] } } } }
  const first = withMissingDefaults({}).settings as Written

  first.ccChatTweaks.prompt['prompt-upgrade']['silent-triggers'].push('>>')
  const second = withMissingDefaults({}).settings as Written

  expect(second.ccChatTweaks.prompt['prompt-upgrade']['silent-triggers']).toEqual(['+++'])
})

test('describes every extra key with its value and the source it came from', () => {
  const report = describeExtras([
    ['policy', {}],
    ['local', up({ model: 'sonnet', 'silent-triggers': ['>>'] })],
    ['user', up({ model: 'opus', effort: 'high', 'min-length': 40 })],
  ])

  expect(report).toEqual([
    { key: 'min-length', value: 40, from: 'user' },
    { key: 'silent-triggers', value: ['>>'], from: 'local' },
    { key: 'model', value: 'sonnet', from: 'local' },
    { key: 'effort', value: 'high', from: 'user' },
    { key: 'unfolded-tools', value: ['AskUserQuestion', 'Skill', 'Agent'], from: 'default' },
  ])
  expect(describeExtras([['user', {}]])).toEqual([
    { key: 'min-length', value: 10, from: 'default' },
    { key: 'silent-triggers', value: ['+++'], from: 'default' },
    { key: 'model', value: 'haiku', from: 'default' },
    { key: 'effort', value: 'low', from: 'default' },
    { key: 'unfolded-tools', value: ['AskUserQuestion', 'Skill', 'Agent'], from: 'default' },
  ])
  expect(describeExtras([['user', chat({ 'unfolded-tools': [] })]]).at(-1)).toEqual({ key: 'unfolded-tools', value: [], from: 'user' })
})

const chat = (group: Record<string, unknown>) => ({ ccChatTweaks: { chat: { 'tool-fold': group } } })

test('unfolded-tools is the first array of tool names, an empty array is a valid choice and the default list is the old hard-coded one', () => {
  expect(DEFAULT_UNFOLDED_TOOLS).toEqual(['AskUserQuestion', 'Skill', 'Agent'])
  expect(unfoldedToolsOf([])).toBeUndefined()
  expect(unfoldedToolsOf([chat({ 'unfolded-tools': ['Bash', ' Read '] })])).toEqual(['Bash', 'Read'])
  expect(unfoldedToolsOf([chat({ 'unfolded-tools': [] })])).toEqual([])
  expect(unfoldedToolsOf([chat({ 'unfolded-tools': ['  ', 5, null, 'x'.repeat(101)] })])).toBeUndefined()
  expect(unfoldedToolsOf([chat({ 'unfolded-tools': ['Bash', 'Bash', ' Bash'] })])).toEqual(['Bash'])
  expect(unfoldedToolsOf([chat({ 'unfolded-tools': 'Bash' })])).toBeUndefined()
  expect(unfoldedToolsOf([chat({ 'unfolded-tools': 5 })])).toBeUndefined()
  expect(unfoldedToolsOf([chat({ 'unfolded-tools': ['  '] }), chat({ 'unfolded-tools': ['Skill'] })])).toEqual(['Skill'])
  expect(unfoldedToolsOf([up({ 'unfolded-tools': ['Bash'] })])).toBeUndefined()
  expect(unfoldedToolsOf([{ ccChatTweaks: { chat: { 'unfolded-tools': ['Bash'] } } }])).toBeUndefined()
  expect(unfoldedToolsOf([chat({ 'unfolded-tools': Array.from({ length: 60 }, (_, i) => `t${i}`) })])).toHaveLength(50)
})

test('the default unfolded list written to a file is a copy', () => {
  type Written = { ccChatTweaks: { chat: { 'tool-fold': { 'unfolded-tools': string[] } } } }
  const first = withMissingDefaults({}).settings as Written

  first.ccChatTweaks.chat['tool-fold']['unfolded-tools'].push('Bash')
  expect((withMissingDefaults({}).settings as Written).ccChatTweaks.chat['tool-fold']['unfolded-tools']).toEqual(['AskUserQuestion', 'Skill', 'Agent'])
  expect(DEFAULT_UNFOLDED_TOOLS).toEqual(['AskUserQuestion', 'Skill', 'Agent'])
})

test('reports nothing to add when every switch is present', () => {
  const full = {
    ccChatTweaks: {
      chat: { 'tool-fold': { use: true, 'unfolded-tools': ['Bash'] }, 'use-edit-summary': false },
      prompt: {
        'prompt-upgrade': {
          'use-prompt-upgrade': false,
          'use-questions': true,
          'use-silent-upgrade': false,
          'skip-silent-trigger': true,
          'min-length': 25,
          'silent-triggers': ['##', '>>'],
          model: 'sonnet',
          effort: 'high',
        },
      },
    },
  }

  expect(withMissingDefaults(full).added).toEqual([])
  expect(withMissingDefaults(full).settings).toEqual(full)
})
