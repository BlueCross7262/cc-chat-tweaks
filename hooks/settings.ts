export const SETTINGS_NAMESPACE = 'ccChatTweaks'
export const SETTINGS_SOURCES = ['policy', 'flag', 'local', 'project', 'user'] as const

export const FLAG_DEFAULTS = {
  'use-tool-fold': false,
  'use-edit-summary': false,
  'use-prompt-upgrade': false,
  'use-questions': true,
  'use-silent-upgrade': true,
  'skip-silent-trigger': false,
} as const

export type FlagKey = keyof typeof FLAG_DEFAULTS

export const FLAG_GROUPS: Record<FlagKey, string> = {
  'use-tool-fold': 'chat',
  'use-edit-summary': 'chat',
  'use-prompt-upgrade': 'prompt',
  'use-questions': 'prompt',
  'use-silent-upgrade': 'prompt',
  'skip-silent-trigger': 'prompt',
}

export const GROUPS: readonly string[] = [...new Set(Object.values(FLAG_GROUPS))]

export const OPTION_KEYS: readonly FlagKey[] = ['use-questions', 'use-silent-upgrade', 'skip-silent-trigger']

export const isFeatureKey = (key: FlagKey): boolean => !OPTION_KEYS.includes(key)

export type Flags = Record<FlagKey, boolean>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const groupOf = (source: unknown, key: FlagKey): Record<string, unknown> | undefined => {
  const namespace = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined
  const group = isRecord(namespace) ? namespace[FLAG_GROUPS[key]] : undefined

  return isRecord(group) ? group : undefined
}

export const isFlagOn = (sources: readonly unknown[], key: FlagKey): boolean => {
  for (const source of sources) {
    const value = groupOf(source, key)?.[key]

    if (typeof value === 'boolean') return value
  }

  return FLAG_DEFAULTS[key]
}

export const flagKeys = Object.keys(FLAG_DEFAULTS) as FlagKey[]

export const describeFlags = (
  named: readonly (readonly [string, unknown])[],
): { key: FlagKey; value: boolean; from: string }[] =>
  flagKeys.map(key => {
    const hit = named.find(([, source]) => hasFlag(source, key))

    return {
      key,
      value: isFlagOn(
        named.map(([, source]) => source),
        key,
      ),
      from: hit === undefined ? 'default' : hit[0],
    }
  })

export const DEFAULT_MIN_LENGTH = 10
export const DEFAULT_SILENT_TRIGGER = '+++'
export const DEFAULT_MODEL = 'haiku'
export const DEFAULT_EFFORT = 'low'
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const MIN_LENGTH_KEY = 'min-length'
export const SILENT_TRIGGER_KEY = 'silent-trigger'
export const MODEL_KEY = 'model'
export const EFFORT_KEY = 'effort'

const EXTRA_DEFAULTS = {
  [MIN_LENGTH_KEY]: DEFAULT_MIN_LENGTH,
  [SILENT_TRIGGER_KEY]: DEFAULT_SILENT_TRIGGER,
  [MODEL_KEY]: DEFAULT_MODEL,
  [EFFORT_KEY]: DEFAULT_EFFORT,
} as const

export type ExtraKey = keyof typeof EXTRA_DEFAULTS

export type AddedKey = FlagKey | ExtraKey

const isExtraKey = (key: AddedKey): key is ExtraKey => key in EXTRA_DEFAULTS

export const defaultOf = (key: AddedKey): boolean | number | string =>
  isExtraKey(key) ? EXTRA_DEFAULTS[key] : FLAG_DEFAULTS[key]

export const withMissingDefaults = (
  settings: unknown,
): { settings: Record<string, unknown>; added: AddedKey[] } => {
  const root: Record<string, unknown> = isRecord(settings) ? { ...settings } : {}
  const namespace: Record<string, unknown> = isRecord(root[SETTINGS_NAMESPACE])
    ? { ...(root[SETTINGS_NAMESPACE] as Record<string, unknown>) }
    : {}
  const groups: Record<string, Record<string, unknown>> = {}
  const added: AddedKey[] = []

  for (const name of GROUPS) {
    groups[name] = isRecord(namespace[name]) ? { ...(namespace[name] as Record<string, unknown>) } : {}
  }

  for (const key of flagKeys) {
    const group = groups[FLAG_GROUPS[key]] as Record<string, unknown>

    if (group[key] === undefined) {
      group[key] = FLAG_DEFAULTS[key]
      added.push(key)
    }
  }

  const promptGroup = groups.prompt as Record<string, unknown>

  for (const key of Object.keys(EXTRA_DEFAULTS) as ExtraKey[]) {
    if (promptGroup[key] === undefined) {
      promptGroup[key] = EXTRA_DEFAULTS[key]
      added.push(key)
    }
  }

  for (const name of GROUPS) {
    namespace[name] = groups[name]
  }

  root[SETTINGS_NAMESPACE] = namespace

  return { settings: root, added }
}

const hasFlag = (source: unknown, key: FlagKey): boolean => typeof groupOf(source, key)?.[key] === 'boolean'

export const minLengthOf = (sources: readonly unknown[]): number | undefined => {
  for (const source of sources) {
    const namespace = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined
    const group = isRecord(namespace) ? namespace.prompt : undefined
    const value = isRecord(group) ? group[MIN_LENGTH_KEY] : undefined

    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10000) return value
  }

  return undefined
}

export const silentTriggerOf = (sources: readonly unknown[]): string | undefined => {
  for (const source of sources) {
    const namespace = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined
    const group = isRecord(namespace) ? namespace.prompt : undefined
    const value = isRecord(group) ? group[SILENT_TRIGGER_KEY] : undefined

    if (typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 32) return value.trim()
  }

  return undefined
}

export type Effort = (typeof EFFORTS)[number]

export const modelOf = (sources: readonly unknown[]): string | undefined => {
  for (const source of sources) {
    const namespace = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined
    const group = isRecord(namespace) ? namespace.prompt : undefined
    const value = isRecord(group) ? group[MODEL_KEY] : undefined

    if (typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 100) return value.trim()
  }

  return undefined
}

export const effortOf = (sources: readonly unknown[]): Effort | undefined => {
  for (const source of sources) {
    const namespace = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined
    const group = isRecord(namespace) ? namespace.prompt : undefined
    const value = isRecord(group) ? group[EFFORT_KEY] : undefined

    if (typeof value === 'string' && (EFFORTS as readonly string[]).includes(value.trim())) return value.trim() as Effort
  }

  return undefined
}

export const flagsOf = (sources: readonly unknown[]): Flags => ({
  'use-tool-fold': isFlagOn(sources, 'use-tool-fold'),
  'use-edit-summary': isFlagOn(sources, 'use-edit-summary'),
  'use-prompt-upgrade': isFlagOn(sources, 'use-prompt-upgrade'),
  'use-questions': isFlagOn(sources, 'use-questions'),
  'use-silent-upgrade': isFlagOn(sources, 'use-silent-upgrade'),
  'skip-silent-trigger': isFlagOn(sources, 'skip-silent-trigger'),
})
