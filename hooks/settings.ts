export const SETTINGS_NAMESPACE = 'ccChatTweaks'
export const SETTINGS_GROUP = 'chat'
export const SETTINGS_SOURCES = ['policy', 'flag', 'local', 'project', 'user'] as const

export const FLAG_DEFAULTS = {
  'use-tool-fold': false,
  'use-progress-line': false,
  'use-edit-summary': false,
} as const

export type FlagKey = keyof typeof FLAG_DEFAULTS

export type Flags = Record<FlagKey, boolean>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isFlagOn = (sources: readonly unknown[], key: FlagKey): boolean => {
  for (const source of sources) {
    const namespace = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined
    const group = isRecord(namespace) ? namespace[SETTINGS_GROUP] : undefined
    const value = isRecord(group) ? group[key] : undefined

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
  const group: Record<string, unknown> = isRecord(namespace[SETTINGS_GROUP])
    ? { ...(namespace[SETTINGS_GROUP] as Record<string, unknown>) }
    : {}
  const added = flagKeys.filter(key => group[key] === undefined)

  for (const key of added) {
    group[key] = FLAG_DEFAULTS[key]
  }

  namespace[SETTINGS_GROUP] = group
  root[SETTINGS_NAMESPACE] = namespace

  return { settings: root, added }
}

const hasFlag = (source: unknown, key: FlagKey): boolean => {
  const namespace = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined
  const group = isRecord(namespace) ? namespace[SETTINGS_GROUP] : undefined

  return isRecord(group) && typeof group[key] === 'boolean'
}

export const flagsOf = (sources: readonly unknown[]): Flags => ({
  'use-tool-fold': isFlagOn(sources, 'use-tool-fold'),
  'use-progress-line': isFlagOn(sources, 'use-progress-line'),
  'use-edit-summary': isFlagOn(sources, 'use-edit-summary'),
})
