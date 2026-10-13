export const SETTINGS_NAMESPACE = 'promptUpgrade'
export const SETTINGS_GROUP = 'chat'
export const SETTINGS_SOURCES = ['policy', 'flag', 'local', 'project', 'user'] as const

export const FLAG_DEFAULTS = {
  'use-prompt-upgrade': false,
  'use-questions': true,
} as const

export type FlagKey = keyof typeof FLAG_DEFAULTS

export type Flags = Record<FlagKey, boolean>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const groupOf = (source: unknown): Record<string, unknown> | undefined => {
  const namespace = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined
  const group = isRecord(namespace) ? namespace[SETTINGS_GROUP] : undefined

  return isRecord(group) ? group : undefined
}

const hasFlag = (source: unknown, key: FlagKey): boolean => typeof groupOf(source)?.[key] === 'boolean'

export const isFlagOn = (sources: readonly unknown[], key: FlagKey): boolean => {
  for (const source of sources) {
    const value = groupOf(source)?.[key]

    if (typeof value === 'boolean') return value
  }

  return FLAG_DEFAULTS[key]
}

export const flagKeys = Object.keys(FLAG_DEFAULTS) as FlagKey[]

export const flagsOf = (sources: readonly unknown[]): Flags => ({
  'use-prompt-upgrade': isFlagOn(sources, 'use-prompt-upgrade'),
  'use-questions': isFlagOn(sources, 'use-questions'),
})

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
