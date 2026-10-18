import { expect, test } from 'claude-code/testing'

import {
  CALL_NAMES,
  DEFAULT_MODELS,
  DEFAULT_UNFOLDED_TOOLS,
  describeExtras,
  describeFlags,
  effortIn,
  extraKeys,
  FLAG_PATHS,
  flagsOf,
  ignoredKeysOf,
  isFlagOn,
  labelOf,
  minLengthOf,
  modelIn,
  propOf,
  resolveEffort,
  resolveModel,
  silentOffTriggersOf,
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

test('silent-off-triggers follows the same entry rules, and an empty array turns the opt-out off', () => {
  const off = (value: unknown) => up({ 'silent-off-triggers': value })

  expect(silentOffTriggersOf([])).toBeUndefined()
  expect(silentOffTriggersOf([off(['  ~~  ', '---'])])).toEqual(['~~', '---'])
  expect(silentOffTriggersOf([off([])])).toEqual([])
  expect(silentOffTriggersOf([off([]), off(['~~'])])).toEqual([])
  expect(silentOffTriggersOf([off(['  ', 5])])).toBeUndefined()
  expect(silentOffTriggersOf([off('---')])).toBeUndefined()
  expect(silentOffTriggersOf([triggers(['+++'])])).toBeUndefined()
})

test('silent-triggers keeps at most 10 entries', () => {
  const many = Array.from({ length: 15 }, (_, i) => `t${i}`)

  expect(silentTriggersOf([triggers(many)])).toEqual(many.slice(0, 10))
})

const call = (name: string, entry: unknown) => up({ models: { [name]: entry } })

test('the model of a call is the first trimmed string of 1 to 100 characters under its own models entry', () => {
  expect(modelIn([], 'ask')).toBeUndefined()
  expect(modelIn([call('ask', { model: '  sonnet  ' })], 'ask')).toBe('sonnet')
  expect(
    modelIn(
      [
        call('ask', { model: '   ' }),
        call('ask', { model: 5 }),
        call('ask', { model: 'x'.repeat(101) }),
        call('ask', { model: 'claude-haiku-5-5' }),
      ],
      'ask',
    ),
  ).toBe('claude-haiku-5-5')
  expect(modelIn([{ ccChatTweaks: { chat: { models: { ask: { model: 'opus' } } } } }], 'ask')).toBeUndefined()
})

test('the effort of a call is the first value among low, medium, high, xhigh and max under its own models entry', () => {
  expect(effortIn([], 'rewrite')).toBeUndefined()
  expect(effortIn([call('rewrite', { effort: 'high' })], 'rewrite')).toBe('high')
  expect(effortIn([call('rewrite', { effort: ' max ' })], 'rewrite')).toBe('max')
  expect(
    effortIn(
      [
        call('rewrite', { effort: 'LOW' }),
        call('rewrite', { effort: 3 }),
        call('rewrite', { effort: 'ultra' }),
        call('rewrite', { effort: 'xhigh' }),
      ],
      'rewrite',
    ),
  ).toBe('xhigh')
})

test('a call reads only its own entry and the first source with a valid value wins', () => {
  const sources = [call('ask', { model: 'opus', effort: 'high' }), call('rewrite', { model: 'haiku' }), call('ask', { model: 'sonnet' })]

  expect(modelIn(sources, 'ask')).toBe('opus')
  expect(modelIn(sources, 'rewrite')).toBe('haiku')
  expect(modelIn(sources, 'classify')).toBeUndefined()
  expect(effortIn(sources, 'ask')).toBe('high')
  expect(effortIn(sources, 'rewrite')).toBeUndefined()
  expect(modelIn([call('ask', { model: 5 }), call('ask', { model: 'sonnet' })], 'ask')).toBe('sonnet')
  expect(modelIn([up({ models: { foo: { model: 'opus' } } })], 'ask')).toBeUndefined()
})

test('a source that is not a settings object, or whose models entry is not an object, is skipped without an error', () => {
  const broken = [
    undefined,
    null,
    'x',
    5,
    [],
    {},
    { ccChatTweaks: 'x' },
    { ccChatTweaks: { prompt: 'x' } },
    { ccChatTweaks: { prompt: { 'prompt-upgrade': 'x' } } },
    up({ models: 'opus' }),
    up({ models: ['opus'] }),
    up({ models: null }),
    up({ models: { ask: 'opus' } }),
    up({ models: { ask: ['opus'] } }),
    up({ models: { ask: null } }),
  ]

  expect(modelIn(broken, 'ask')).toBeUndefined()
  expect(effortIn(broken, 'ask')).toBeUndefined()
  expect(resolveModel(broken, 'ask')).toBe('sonnet')
  expect(resolveEffort(broken, 'ask')).toBe('low')
  expect(modelIn([...broken, call('ask', { model: 'opus' })], 'ask')).toBe('opus')
})

test('a call with no valid value falls back to its default: haiku for classify and sonnet for the others, all at low effort', () => {
  expect(DEFAULT_MODELS).toEqual({
    ask: { model: 'sonnet', effort: 'low' },
    rewrite: { model: 'sonnet', effort: 'low' },
    classify: { model: 'haiku', effort: 'low' },
  })
  expect(CALL_NAMES).toEqual(['ask', 'rewrite', 'classify'])
  expect(resolveModel([], 'classify')).toBe('haiku')
  expect(resolveEffort([], 'classify')).toBe('low')
  expect(resolveModel([call('rewrite', { model: 'opus' })], 'ask')).toBe('sonnet')
  expect(resolveModel([call('classify', { model: ' opus ' })], 'classify')).toBe('opus')
  expect(resolveEffort([call('rewrite', { effort: 'max' })], 'rewrite')).toBe('max')
  expect(resolveEffort([call('rewrite', { effort: 'ultra' })], 'rewrite')).toBe('low')
})

test('the old model keys are neither read for a call nor listed as extra keys, and doctor finds them by source', () => {
  const old = up({ model: 'opus', effort: 'high', 'type-model': 'sonnet', 'type-effort': 'medium' })

  expect(resolveModel([old], 'ask')).toBe('sonnet')
  expect(resolveEffort([old], 'ask')).toBe('low')
  expect(resolveModel([old], 'classify')).toBe('haiku')
  expect(resolveEffort([old], 'classify')).toBe('low')
  expect(extraKeys).not.toContain('model')
  expect(extraKeys).not.toContain('type-model')
  expect(ignoredKeysOf([['policy', {}], ['user', old], ['local', up({ effort: 'low' })]])).toEqual([
    { key: 'model', from: 'user' },
    { key: 'effort', from: 'user' },
    { key: 'type-model', from: 'user' },
    { key: 'type-effort', from: 'user' },
    { key: 'effort', from: 'local' },
  ])
  expect(ignoredKeysOf([['user', up({ models: { ask: { model: 'opus' } } })], ['local', null], ['project', { ccChatTweaks: { chat: { model: 'x' } } }]])).toEqual([])
})

test('the defaults when no source sets a key', () => {
  expect(isFlagOn([], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([], 'use-edit-summary')).toBe(false)
  expect(isFlagOn([], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([], 'use-questions')).toBe(false)
  expect(isFlagOn([], 'use-silent-upgrade')).toBe(true)
  expect(isFlagOn([], 'skip-silent-trigger')).toBe(true)
  expect(isFlagOn([up({ 'skip-silent-trigger': false })], 'skip-silent-trigger')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'skip-silent-trigger': false } } }], 'skip-silent-trigger')).toBe(true)
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
  expect(propOf('use-prompt-upgrade')).toBe('use')
  expect(isFlagOn([up({ use: false })], 'use-prompt-upgrade')).toBe(false)
  expect(isFlagOn([up({ 'use-prompt-upgrade': false })], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { prompt: { use: false } } }], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { prompt: { 'use-prompt-upgrade': false } } }], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { 'prompt-upgrade': { use: false } } }], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([up({ use: 'no' })], 'use-prompt-upgrade')).toBe(true)
  expect(minLengthOf([{ ccChatTweaks: { prompt: { 'min-length': 40 } } }])).toBeUndefined()
  expect(modelIn([{ ccChatTweaks: { prompt: { models: { ask: { model: 'opus' } } } } }], 'ask')).toBeUndefined()
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-prompt-upgrade': false } } }], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-questions': true } } }], 'use-questions')).toBe(false)
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
  expect(labelOf('use-prompt-upgrade')).toBe('prompt.prompt-upgrade.use')
  expect(labelOf('use-questions')).toBe('prompt.prompt-upgrade.use-questions')
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
    'use-questions': false,
    'use-silent-upgrade': true,
    'skip-silent-trigger': true,
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

  expect(added).toEqual([
    'use-edit-summary',
    'use-prompt-upgrade',
    'use-questions',
    'use-silent-upgrade',
    'skip-silent-trigger',
    'min-length',
    'silent-triggers',
    'silent-off-triggers',
    'models.ask.model',
    'models.ask.effort',
    'models.rewrite.model',
    'models.rewrite.effort',
    'models.classify.model',
    'models.classify.effort',
    'unfolded-tools',
  ])
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
          use: true,
          'use-questions': false,
          'use-silent-upgrade': true,
          'skip-silent-trigger': true,
          'min-length': 10,
          'silent-triggers': ['+++'],
          'silent-off-triggers': ['---'],
          models: DEFAULT_MODELS,
        },
      },
      other: 1,
    },
  })
  expect(existing.ccChatTweaks.chat).toEqual({ 'tool-fold': { use: true } })
  expect(existing.ccChatTweaks.prompt).toEqual({ later: { 'a-future-key': 1 } })
})

test('builds the whole section for an empty or malformed file', () => {
  expect(withMissingDefaults({}).added).toHaveLength(16)
  expect(withMissingDefaults(null).added).toHaveLength(16)
  expect(withMissingDefaults({ ccChatTweaks: 'x' }).settings).toEqual({
    ccChatTweaks: {
      chat: {
        'tool-fold': { use: false, 'unfolded-tools': ['AskUserQuestion', 'Skill', 'Agent'] },
        'use-edit-summary': false,
      },
      prompt: {
        'prompt-upgrade': {
          use: true,
          'use-questions': false,
          'use-silent-upgrade': true,
          'skip-silent-trigger': true,
          'min-length': 10,
          'silent-triggers': ['+++'],
          'silent-off-triggers': ['---'],
          models: DEFAULT_MODELS,
        },
      },
    },
  })
})

test('the old location is left alone and its keys are not read', () => {
  const old = { ccChatTweaks: { prompt: { 'use-prompt-upgrade': false, model: 'opus' } } }
  const { settings, added } = withMissingDefaults(old)
  const prompt = (settings.ccChatTweaks as { prompt: Record<string, unknown> }).prompt

  expect(added).toContain('use-prompt-upgrade')
  expect(prompt['use-prompt-upgrade']).toBe(false)
  expect(prompt.model).toBe('opus')
  expect((prompt['prompt-upgrade'] as Record<string, unknown>).use).toBe(true)
  expect((prompt['prompt-upgrade'] as Record<string, unknown>).models).toEqual(DEFAULT_MODELS)
  expect(isFlagOn([settings], 'use-prompt-upgrade')).toBe(true)
  expect(modelIn([settings], 'ask')).toBe('sonnet')
})

test('a models entry the person already set is kept, and only the missing leaves are added', () => {
  const existing = { ccChatTweaks: { prompt: { 'prompt-upgrade': { models: { rewrite: { model: 'opus', note: 'mine' }, ask: { effort: null } } } } } }
  const { settings, added } = withMissingDefaults(existing)
  const models = (settings.ccChatTweaks as { prompt: { 'prompt-upgrade': { models: Record<string, Record<string, unknown>> } } }).prompt['prompt-upgrade'].models

  expect(models.rewrite).toEqual({ model: 'opus', note: 'mine', effort: 'low' })
  expect(models.ask).toEqual({ effort: null, model: 'sonnet' })
  expect(models.classify).toEqual({ model: 'haiku', effort: 'low' })
  expect(added).not.toContain('models.rewrite.model')
  expect(added).not.toContain('models.ask.effort')
  expect(added).toContain('models.rewrite.effort')
  expect(added).toContain('models.ask.model')
  expect(existing.ccChatTweaks.prompt['prompt-upgrade'].models.rewrite).toEqual({ model: 'opus', note: 'mine' })
})

test('a models value or call entry that is not an object is replaced, as the groups above it are', () => {
  for (const bad of ['opus', ['opus'], null, 5]) {
    const { settings } = withMissingDefaults({ ccChatTweaks: { prompt: { 'prompt-upgrade': { models: bad } } } })
    const models = (settings.ccChatTweaks as { prompt: { 'prompt-upgrade': { models: unknown } } }).prompt['prompt-upgrade'].models

    expect(models).toEqual(DEFAULT_MODELS)
  }

  const { settings } = withMissingDefaults({ ccChatTweaks: { prompt: { 'prompt-upgrade': { models: { ask: 'opus' } } } } })
  const models = (settings.ccChatTweaks as { prompt: { 'prompt-upgrade': { models: Record<string, unknown> } } }).prompt['prompt-upgrade'].models

  expect(models.ask).toEqual({ model: 'sonnet', effort: 'low' })
})

test('no model key is written as a literal dotted property name', () => {
  const written = (withMissingDefaults({}).settings.ccChatTweaks as { prompt: { 'prompt-upgrade': Record<string, unknown> } }).prompt['prompt-upgrade']

  expect(Object.keys(written).filter(key => key.includes('.'))).toEqual([])
  expect(written.model).toBeUndefined()
  expect(written['type-model']).toBeUndefined()
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
    ['local', up({ models: { ask: { model: 'sonnet' }, rewrite: { model: 'haiku' } }, 'silent-triggers': ['>>'] })],
    ['user', up({ models: { ask: { model: 'opus', effort: 'high' }, classify: { model: 'sonnet' } }, 'min-length': 40 })],
  ])

  expect(report).toEqual([
    { key: 'min-length', value: 40, from: 'user' },
    { key: 'silent-triggers', value: ['>>'], from: 'local' },
    { key: 'silent-off-triggers', value: ['---'], from: 'default' },
    { key: 'models.ask.model', value: 'sonnet', from: 'local' },
    { key: 'models.ask.effort', value: 'high', from: 'user' },
    { key: 'models.rewrite.model', value: 'haiku', from: 'local' },
    { key: 'models.rewrite.effort', value: 'low', from: 'default' },
    { key: 'models.classify.model', value: 'sonnet', from: 'user' },
    { key: 'models.classify.effort', value: 'low', from: 'default' },
    { key: 'unfolded-tools', value: ['AskUserQuestion', 'Skill', 'Agent'], from: 'default' },
  ])
  expect(describeExtras([['user', {}]])).toEqual([
    { key: 'min-length', value: 10, from: 'default' },
    { key: 'silent-triggers', value: ['+++'], from: 'default' },
    { key: 'silent-off-triggers', value: ['---'], from: 'default' },
    { key: 'models.ask.model', value: 'sonnet', from: 'default' },
    { key: 'models.ask.effort', value: 'low', from: 'default' },
    { key: 'models.rewrite.model', value: 'sonnet', from: 'default' },
    { key: 'models.rewrite.effort', value: 'low', from: 'default' },
    { key: 'models.classify.model', value: 'haiku', from: 'default' },
    { key: 'models.classify.effort', value: 'low', from: 'default' },
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
          use: false,
          'use-questions': true,
          'use-silent-upgrade': false,
          'skip-silent-trigger': true,
          'min-length': 25,
          'silent-triggers': ['##', '>>'],
          'silent-off-triggers': [],
          models: {
            ask: { model: 'sonnet', effort: 'high' },
            rewrite: { model: 'opus', effort: 'low' },
            classify: { model: 'sonnet', effort: 'medium' },
          },
        },
      },
    },
  }

  expect(withMissingDefaults(full).added).toEqual([])
  expect(withMissingDefaults(full).settings).toEqual(full)
})
