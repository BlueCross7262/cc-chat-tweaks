export const SETTINGS_NAMESPACE = 'ccChatTweaks'
export const SETTINGS_SOURCES = ['policy', 'flag', 'local', 'project', 'user'] as const

export const FLAG_DEFAULTS = {
  'use-tool-fold': false,
  'use-edit-summary': false,
  'use-prompt-upgrade': false,
  'use-questions': true,
} as const

export type FlagKey = keyof typeof FLAG_DEFAULTS

export const FLAG_GROUPS: Record<FlagKey, string> = {
  'use-tool-fold': 'chat',
  'use-edit-summary': 'chat',
  'use-prompt-upgrade': 'prompt',
  'use-questions': 'prompt',
}

export const GROUPS: readonly string[] = [...new Set(Object.values(FLAG_GROUPS))]

export const OPTION_KEYS: readonly FlagKey[] = ['use-questions']

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

export const withMissingDefaults = (
  settings: unknown,
): { settings: Record<string, unknown>; added: FlagKey[] } => {
  const root: Record<string, unknown> = isRecord(settings) ? { ...settings } : {}
  const namespace: Record<string, unknown> = isRecord(root[SETTINGS_NAMESPACE])
    ? { ...(root[SETTINGS_NAMESPACE] as Record<string, unknown>) }
    : {}
  const groups: Record<string, Record<string, unknown>> = {}
  const added: FlagKey[] = []

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

  for (const name of GROUPS) {
    namespace[name] = groups[name]
  }

  root[SETTINGS_NAMESPACE] = namespace

  return { settings: root, added }
}

const hasFlag = (source: unknown, key: FlagKey): boolean => typeof groupOf(source, key)?.[key] === 'boolean'

export const flagsOf = (sources: readonly unknown[]): Flags => ({
  'use-tool-fold': isFlagOn(sources, 'use-tool-fold'),
  'use-edit-summary': isFlagOn(sources, 'use-edit-summary'),
  'use-prompt-upgrade': isFlagOn(sources, 'use-prompt-upgrade'),
  'use-questions': isFlagOn(sources, 'use-questions'),
})
