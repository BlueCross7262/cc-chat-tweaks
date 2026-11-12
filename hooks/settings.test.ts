import { expect, test } from 'claude-code/testing'

import {
  BAND_PATH,
  bandOrderOf,
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
  isFeatureKey,
  isFlagOn,
  labelOf,
  minLengthOf,
  modelIn,
  propOf,
  resolveEffort,
  resolveModel,
  silentOffTriggersOf,
  silentTriggersOf,
  todoToolsOf,
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

test('the todo lines switch is env.CLAUDE_CODE_ENABLE_TODO_TOOLS, read from the first source that holds a string, and only 1 turns it on', () => {
  const env = (value: unknown) => ({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: value } })
  expect(todoToolsOf([])).toBe(false)
  expect(todoToolsOf([env('1')])).toBe(true)
  expect(todoToolsOf([env('0')])).toBe(false)
  expect(todoToolsOf([env('true')])).toBe(false)
  expect(todoToolsOf([env(1), {}, null, { env: 'x' }])).toBe(false)
  expect(todoToolsOf([env('0'), env('1')])).toBe(false)
  expect(todoToolsOf([{}, env(1), env('1')])).toBe(true)
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
  expect(modelIn([], 'classify')).toBeUndefined()
  expect(modelIn([call('classify', { model: '  sonnet  ' })], 'classify')).toBe('sonnet')
  expect(
    modelIn(
      [
        call('classify', { model: '   ' }),
        call('classify', { model: 5 }),
        call('classify', { model: 'x'.repeat(101) }),
        call('classify', { model: 'claude-haiku-5-5' }),
      ],
      'classify',
    ),
  ).toBe('claude-haiku-5-5')
  expect(modelIn([{ ccChatTweaks: { chat: { models: { classify: { model: 'opus' } } } } }], 'classify')).toBeUndefined()
})

test('the effort of a call is the first value among low, medium, high, xhigh and max under its own models entry', () => {
  expect(effortIn([], 'classify')).toBeUndefined()
  expect(effortIn([call('classify', { effort: 'high' })], 'classify')).toBe('high')
  expect(effortIn([call('classify', { effort: ' max ' })], 'classify')).toBe('max')
  expect(
    effortIn(
      [
        call('classify', { effort: 'LOW' }),
        call('classify', { effort: 3 }),
        call('classify', { effort: 'ultra' }),
        call('classify', { effort: 'xhigh' }),
      ],
      'classify',
    ),
  ).toBe('xhigh')
})

test('a call reads only its own entry and the first source with a valid value wins', () => {
  const sources = [call('ask', { model: 'opus', effort: 'high' }), call('classify', { model: 'haiku' }), call('classify', { model: 'sonnet', effort: 'max' })]

  expect(modelIn(sources, 'classify')).toBe('haiku')
  expect(effortIn(sources, 'classify')).toBe('max')
  expect(modelIn([up({ models: { foo: { model: 'opus' } } })], 'classify')).toBeUndefined()
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
    up({ models: { classify: 'opus' } }),
    up({ models: { classify: ['opus'] } }),
    up({ models: { classify: null } }),
  ]

  expect(modelIn(broken, 'classify')).toBeUndefined()
  expect(effortIn(broken, 'classify')).toBeUndefined()
  expect(resolveModel(broken, 'classify')).toBe('haiku')
  expect(resolveEffort(broken, 'classify')).toBe('low')
  expect(modelIn([...broken, call('classify', { model: 'opus' })], 'classify')).toBe('opus')
})

test('classify is the only call and falls back to haiku at low effort', () => {
  expect(DEFAULT_MODELS).toEqual({ classify: { model: 'haiku', effort: 'low' } })
  expect(CALL_NAMES).toEqual(['classify'])
  expect(resolveModel([], 'classify')).toBe('haiku')
  expect(resolveEffort([], 'classify')).toBe('low')
  expect(resolveModel([call('classify', { model: ' opus ' })], 'classify')).toBe('opus')
  expect(resolveEffort([call('classify', { effort: 'ultra' })], 'classify')).toBe('low')
})

test('the old classify keys are not read and doctor finds them by source', () => {
  const old = up({ 'type-model': 'sonnet', 'type-effort': 'medium' })

  expect(resolveModel([old], 'classify')).toBe('haiku')
  expect(resolveEffort([old], 'classify')).toBe('low')
  expect(extraKeys).not.toContain('type-model')
  expect(ignoredKeysOf([['policy', {}], ['user', old], ['local', up({ 'type-effort': 'low' })]])).toEqual([
    { key: 'type-model', from: 'user' },
    { key: 'type-effort', from: 'user' },
    { key: 'type-effort', from: 'local' },
  ])
})

test('the removed keys are not read, not listed as ignored, not written and left in the file untouched', () => {
  const removed = {
    'use-rewrite': true,
    'use-questions': true,
    'use-silent-upgrade': false,
    model: 'opus',
    effort: 'high',
    models: { ask: { model: 'opus' }, rewrite: { model: 'opus' } },
  }

  expect(ignoredKeysOf([['user', up(removed)]])).toEqual([])
  expect(Object.keys(flagsOf([up(removed)])).sort()).toEqual(Object.keys(flagsOf([])).sort())
  expect(extraKeys.filter(key => /ask|rewrite/.test(key))).toEqual([])
  const kept = withMissingDefaults(up(removed))
  const group = (kept.settings.ccChatTweaks as { prompt: { 'prompt-upgrade': Record<string, unknown> } }).prompt['prompt-upgrade']
  expect(group['use-rewrite']).toBe(true)
  expect(group['use-silent-upgrade']).toBe(false)
  expect((group.models as Record<string, unknown>).ask).toEqual({ model: 'opus' })
  for (const key of ['use-rewrite', 'use-questions', 'use-silent-upgrade', 'models.ask.model', 'models.rewrite.model']) {
    expect(withMissingDefaults({}).added as readonly string[]).not.toContain(key)
  }
})

test('the defaults when no source sets a key', () => {
  expect(isFlagOn([], 'use-tool-fold')).toBe(false)
  expect(isFlagOn([], 'use-edit-summary')).toBe(false)
  expect(isFlagOn([], 'use-prompt-upgrade')).toBe(true)
  expect(isFlagOn([], 'skip-silent-trigger')).toBe(true)
  expect(isFlagOn([], 'use-char-count')).toBe(false)
  expect(isFlagOn([], 'use-answer-colors')).toBe(false)
  expect(isFlagOn([up({ 'skip-silent-trigger': false })], 'skip-silent-trigger')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'skip-silent-trigger': false } } }], 'skip-silent-trigger')).toBe(true)
  expect(isFlagOn([{}, { ccChatTweaks: {} }, { ccChatTweaks: { chat: {} } }], 'use-tool-fold')).toBe(false)
})

test('the prompt upgrade keys live under ccChatTweaks.prompt.prompt-upgrade and are read from nowhere else', () => {
  for (const key of ['use-prompt-upgrade', 'skip-silent-trigger'] as const) {
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
  expect(modelIn([{ ccChatTweaks: { prompt: { models: { classify: { model: 'opus' } } } } }], 'classify')).toBeUndefined()
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-prompt-upgrade': false } } }], 'use-prompt-upgrade')).toBe(true)
})

test('skip-silent-trigger is an option of the prompt upgrade, not a feature', () => {
  expect(isFeatureKey('skip-silent-trigger')).toBe(false)
  expect(isFeatureKey('use-prompt-upgrade')).toBe(true)
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

test('the character count is switched by ccChatTweaks.prompt.char-count.use and by nothing else', () => {
  expect(FLAG_PATHS['use-char-count']).toEqual(['prompt', 'char-count'])
  expect(propOf('use-char-count')).toBe('use')
  expect(isFlagOn([{ ccChatTweaks: { prompt: { 'char-count': { use: true } } } }], 'use-char-count')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { prompt: { 'char-count': { use: false } } } }, { ccChatTweaks: { prompt: { 'char-count': { use: true } } } }], 'use-char-count')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { prompt: { 'char-count': { use: 'yes' } } } }], 'use-char-count')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { prompt: { 'use-char-count': true } } }], 'use-char-count')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { prompt: { 'prompt-upgrade': { use: true } } } }], 'use-char-count')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { 'char-count': { use: true } } }], 'use-char-count')).toBe(false)
})

test('the answer colours are switched by ccChatTweaks.chat.answer-colors.use and by nothing else', () => {
  expect(FLAG_PATHS['use-answer-colors']).toEqual(['chat', 'answer-colors'])
  expect(propOf('use-answer-colors')).toBe('use')
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'answer-colors': { use: true } } } }], 'use-answer-colors')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'answer-colors': { use: false } } } }, { ccChatTweaks: { chat: { 'answer-colors': { use: true } } } }], 'use-answer-colors')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'answer-colors': { use: 'yes' } } } }], 'use-answer-colors')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { 'use-answer-colors': true } } }], 'use-answer-colors')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { 'answer-colors': { use: true } } }], 'use-answer-colors')).toBe(false)
})

test('the label of a key is the path of its setting under ccChatTweaks', () => {
  expect(labelOf('use-tool-fold')).toBe('chat.tool-fold.use')
  expect(labelOf('use-edit-summary')).toBe('chat.use-edit-summary')
  expect(labelOf('unfolded-tools')).toBe('chat.tool-fold.unfolded-tools')
  expect(labelOf('use-prompt-upgrade')).toBe('prompt.prompt-upgrade.use')
  expect(labelOf('skip-silent-trigger')).toBe('prompt.prompt-upgrade.skip-silent-trigger')
  expect(labelOf('min-length')).toBe('prompt.prompt-upgrade.min-length')
  expect(labelOf('use-char-count')).toBe('prompt.char-count.use')
  expect(labelOf('use-answer-colors')).toBe('chat.answer-colors.use')
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
    'skip-silent-trigger': true,
    'use-char-count': false,
    'use-answer-colors': false,
    'use-band': false,
    'use-band-turns': true,
    'use-band-elapsed': true,
    'use-band-speed': true,
    'use-band-turn-cost': true,
    'use-band-session-cost': true,
    'use-band-context': true,
    'use-band-cache': true,
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
    'skip-silent-trigger',
    'use-char-count',
    'use-answer-colors',
    'use-band',
    'use-band-turns',
    'use-band-elapsed',
    'use-band-speed',
    'use-band-turn-cost',
    'use-band-session-cost',
    'use-band-context',
    'use-band-cache',
    'min-length',
    'silent-triggers',
    'silent-off-triggers',
    'models.classify.model',
    'models.classify.effort',
    'unfolded-tools',
    'order',
  ])
  expect(settings).toEqual({
    theme: 'dark',
    ccChatTweaks: {
      chat: {
        'tool-fold': { use: true, 'unfolded-tools': ['AskUserQuestion', 'Skill', 'Agent'] },
        'use-edit-summary': false,
        'answer-colors': { use: false },
        band: { use: false, 'use-turns': true, 'use-elapsed': true, 'use-speed': true, 'use-turn-cost': true, 'use-session-cost': true, 'use-context': true, 'use-cache': true, order: ['turns', 'elapsed', 'speed', 'turn-cost', 'session-cost', 'context', 'cache'] },
      },
      prompt: {
        later: { 'a-future-key': 1 },
        'prompt-upgrade': {
          use: true,
          'skip-silent-trigger': true,
          'min-length': 10,
          'silent-triggers': ['+++'],
          'silent-off-triggers': ['---'],
          models: DEFAULT_MODELS,
        },
        'char-count': { use: false },
      },
      other: 1,
    },
  })
  expect(existing.ccChatTweaks.chat).toEqual({ 'tool-fold': { use: true } })
  expect(existing.ccChatTweaks.prompt).toEqual({ later: { 'a-future-key': 1 } })
})

test('builds the whole section for an empty or malformed file', () => {
  expect(withMissingDefaults({}).added).toHaveLength(21)
  expect(withMissingDefaults(null).added).toHaveLength(21)
  expect(withMissingDefaults({ ccChatTweaks: 'x' }).settings).toEqual({
    ccChatTweaks: {
      chat: {
        'tool-fold': { use: false, 'unfolded-tools': ['AskUserQuestion', 'Skill', 'Agent'] },
        'use-edit-summary': false,
        'answer-colors': { use: false },
        band: { use: false, 'use-turns': true, 'use-elapsed': true, 'use-speed': true, 'use-turn-cost': true, 'use-session-cost': true, 'use-context': true, 'use-cache': true, order: ['turns', 'elapsed', 'speed', 'turn-cost', 'session-cost', 'context', 'cache'] },
      },
      prompt: {
        'prompt-upgrade': {
          use: true,
          'skip-silent-trigger': true,
          'min-length': 10,
          'silent-triggers': ['+++'],
          'silent-off-triggers': ['---'],
          models: DEFAULT_MODELS,
        },
        'char-count': { use: false },
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
  expect(modelIn([settings], 'classify')).toBe('haiku')
})

test('a models entry the person already set is kept, and only the missing leaves are added', () => {
  const existing = { ccChatTweaks: { prompt: { 'prompt-upgrade': { models: { classify: { model: 'opus', note: 'mine' } } } } } }
  const { settings, added } = withMissingDefaults(existing)
  const models = (settings.ccChatTweaks as { prompt: { 'prompt-upgrade': { models: Record<string, Record<string, unknown>> } } }).prompt['prompt-upgrade'].models

  expect(models.classify).toEqual({ model: 'opus', note: 'mine', effort: 'low' })
  expect(added).not.toContain('models.classify.model')
  expect(added).toContain('models.classify.effort')
  expect(existing.ccChatTweaks.prompt['prompt-upgrade'].models.classify).toEqual({ model: 'opus', note: 'mine' })
})

test('a models value or call entry that is not an object is replaced, as the groups above it are', () => {
  for (const bad of ['opus', ['opus'], null, 5]) {
    const { settings } = withMissingDefaults({ ccChatTweaks: { prompt: { 'prompt-upgrade': { models: bad } } } })
    const models = (settings.ccChatTweaks as { prompt: { 'prompt-upgrade': { models: unknown } } }).prompt['prompt-upgrade'].models

    expect(models).toEqual(DEFAULT_MODELS)
  }

  const { settings } = withMissingDefaults({ ccChatTweaks: { prompt: { 'prompt-upgrade': { models: { classify: 'opus' } } } } })
  const models = (settings.ccChatTweaks as { prompt: { 'prompt-upgrade': { models: Record<string, unknown> } } }).prompt['prompt-upgrade'].models

  expect(models.classify).toEqual({ model: 'haiku', effort: 'low' })
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
    ['local', up({ models: { classify: { effort: 'high' } }, 'silent-triggers': ['>>'] })],
    ['user', up({ models: { classify: { model: 'sonnet' } }, 'min-length': 40 })],
  ])

  expect(report).toEqual([
    { key: 'min-length', value: 40, from: 'user' },
    { key: 'silent-triggers', value: ['>>'], from: 'local' },
    { key: 'silent-off-triggers', value: ['---'], from: 'default' },
    { key: 'models.classify.model', value: 'sonnet', from: 'user' },
    { key: 'models.classify.effort', value: 'high', from: 'local' },
    { key: 'unfolded-tools', value: ['AskUserQuestion', 'Skill', 'Agent'], from: 'default' },
    { key: 'order', value: ['turns', 'elapsed', 'speed', 'turn-cost', 'session-cost', 'context', 'cache'], from: 'default' },
  ])
  expect(describeExtras([['user', {}]])).toEqual([
    { key: 'min-length', value: 10, from: 'default' },
    { key: 'silent-triggers', value: ['+++'], from: 'default' },
    { key: 'silent-off-triggers', value: ['---'], from: 'default' },
    { key: 'models.classify.model', value: 'haiku', from: 'default' },
    { key: 'models.classify.effort', value: 'low', from: 'default' },
    { key: 'unfolded-tools', value: ['AskUserQuestion', 'Skill', 'Agent'], from: 'default' },
    { key: 'order', value: ['turns', 'elapsed', 'speed', 'turn-cost', 'session-cost', 'context', 'cache'], from: 'default' },
  ])
  expect(describeExtras([['user', chat({ 'unfolded-tools': [] })]]).find(row => row.key === 'unfolded-tools')).toEqual({ key: 'unfolded-tools', value: [], from: 'user' })
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
      chat: { 'tool-fold': { use: true, 'unfolded-tools': ['Bash'] }, 'use-edit-summary': false, 'answer-colors': { use: true }, band: { use: false, 'use-turns': true, 'use-elapsed': true, 'use-speed': true, 'use-turn-cost': true, 'use-session-cost': true, 'use-context': true, 'use-cache': true, order: ['turns', 'elapsed', 'speed', 'turn-cost', 'session-cost', 'context', 'cache'] } },
      prompt: {
        'prompt-upgrade': {
          use: false,
          'skip-silent-trigger': true,
          'min-length': 25,
          'silent-triggers': ['##', '>>'],
          'silent-off-triggers': [],
          models: {
            classify: { model: 'sonnet', effort: 'medium' },
          },
        },
        'char-count': { use: true },
      },
    },
  }

  expect(withMissingDefaults(full).added).toEqual([])
  expect(withMissingDefaults(full).settings).toEqual(full)
})

const bandKeys: FlagKey[] = ['use-band-turns', 'use-band-elapsed', 'use-band-speed', 'use-band-turn-cost', 'use-band-session-cost', 'use-band-context', 'use-band-cache']

test('the band is switched by ccChatTweaks.chat.band.use and each item by its own use-* key in the same group', () => {
  expect(BAND_PATH).toEqual(['chat', 'band'])
  expect(FLAG_PATHS['use-band']).toEqual(['chat', 'band'])
  expect(labelOf('use-band')).toBe('chat.band.use')
  expect(labelOf('use-band-turns')).toBe('chat.band.use-turns')
  expect(labelOf('use-band-elapsed')).toBe('chat.band.use-elapsed')
  expect(labelOf('use-band-speed')).toBe('chat.band.use-speed')
  expect(labelOf('use-band-turn-cost')).toBe('chat.band.use-turn-cost')
  expect(labelOf('use-band-session-cost')).toBe('chat.band.use-session-cost')
  expect(labelOf('use-band-context')).toBe('chat.band.use-context')
  expect(labelOf('use-band-cache')).toBe('chat.band.use-cache')
  expect(labelOf('order')).toBe('chat.band.order')
  expect(isFlagOn([], 'use-band')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { band: { use: true } } } }], 'use-band')).toBe(true)
  expect(isFlagOn([{ ccChatTweaks: { chat: { band: { 'use-speed': false } } } }], 'use-band-speed')).toBe(false)
  expect(isFlagOn([{ ccChatTweaks: { chat: { band: { 'use-band-speed': false } } } }], 'use-band-speed')).toBe(true)
})

test('the band switch is a feature and its item switches are options', () => {
  expect(isFeatureKey('use-band')).toBe(true)

  for (const key of bandKeys) {
    expect(isFeatureKey(key)).toBe(false)
    expect(isFlagOn([], key)).toBe(true)
  }
})

const order = (value: unknown) => ({ ccChatTweaks: { chat: { band: { order: value } } } })

test('the band order is the first array of known item names, trimmed and without repeats', () => {
  expect(bandOrderOf([])).toBeUndefined()
  expect(bandOrderOf([order([])])).toEqual([])
  expect(bandOrderOf([order(['cache', 'turns'])])).toEqual(['cache', 'turns'])
  expect(bandOrderOf([order(['x', 'speed'])])).toEqual(['speed'])
  expect(bandOrderOf([order(['speed', 'speed', ' turns '])])).toEqual(['speed', 'turns'])
  expect(bandOrderOf([order([1, null, 'context'])])).toEqual(['context'])
  expect(bandOrderOf([order('speed')])).toBeUndefined()
  expect(bandOrderOf([order(['x'])])).toBeUndefined()
})

test('the band order takes the first source with usable names, as unfolded-tools does', () => {
  expect(bandOrderOf([order(['cache']), order(['turns'])])).toEqual(['cache'])
  expect(bandOrderOf([order('x'), order(['turns'])])).toEqual(['turns'])
  expect(bandOrderOf([order(['x']), order(['turns'])])).toEqual(['turns'])
  expect(bandOrderOf([order([]), order(['turns'])])).toEqual([])
  expect(describeExtras([['local', order(['cache'])]]).find(row => row.key === 'order')).toEqual({ key: 'order', value: ['cache'], from: 'local' })
})
