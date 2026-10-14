export const SETTINGS_NAMESPACE = 'ccChatTweaks'
export const SETTINGS_SOURCES = ['policy', 'flag', 'local', 'project', 'user'] as const

export const FLAG_DEFAULTS = {
  'use-tool-fold': false,
  'use-edit-summary': false,
  'use-prompt-upgrade': true,
  'use-questions': false,
  'use-silent-upgrade': true,
  'skip-silent-trigger': true,
} as const

export type FlagKey = keyof typeof FLAG_DEFAULTS

export const CHAT_PATH: readonly string[] = ['chat']
export const TOOL_FOLD_PATH: readonly string[] = ['chat', 'tool-fold']
export const PROMPT_UPGRADE_PATH: readonly string[] = ['prompt', 'prompt-upgrade']

export const FLAG_PATHS: Record<FlagKey, readonly string[]> = {
  'use-tool-fold': TOOL_FOLD_PATH,
  'use-edit-summary': CHAT_PATH,
  'use-prompt-upgrade': PROMPT_UPGRADE_PATH,
  'use-questions': PROMPT_UPGRADE_PATH,
  'use-silent-upgrade': PROMPT_UPGRADE_PATH,
  'skip-silent-trigger': PROMPT_UPGRADE_PATH,
}

const FLAG_PROPS: Partial<Record<FlagKey, string>> = { 'use-tool-fold': 'use', 'use-prompt-upgrade': 'use' }

export const propOf = (key: FlagKey): string => FLAG_PROPS[key] ?? key

export const GROUP_PATHS: readonly (readonly string[])[] = [CHAT_PATH, TOOL_FOLD_PATH, PROMPT_UPGRADE_PATH]

export const pathText = (path: readonly string[]): string => [SETTINGS_NAMESPACE, ...path].join('.')

export const OPTION_KEYS: readonly FlagKey[] = ['use-questions', 'use-silent-upgrade', 'skip-silent-trigger']

export const isFeatureKey = (key: FlagKey): boolean => !OPTION_KEYS.includes(key)

export type Flags = Record<FlagKey, boolean>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const groupAt = (source: unknown, path: readonly string[]): Record<string, unknown> | undefined => {
  let node: unknown = isRecord(source) ? source[SETTINGS_NAMESPACE] : undefined

  for (const name of path) {
    node = isRecord(node) ? node[name] : undefined
  }

  return isRecord(node) ? node : undefined
}

const groupOf = (source: unknown, key: FlagKey): Record<string, unknown> | undefined =>
  groupAt(source, FLAG_PATHS[key])

const upgradeValueOf = (source: unknown, key: string): unknown => groupAt(source, PROMPT_UPGRADE_PATH)?.[key]

export const isFlagOn = (sources: readonly unknown[], key: FlagKey): boolean => {
  for (const source of sources) {
    const value = groupOf(source, key)?.[propOf(key)]

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
export const DEFAULT_SILENT_TRIGGERS: readonly string[] = ['+++']
export const DEFAULT_MODEL = 'sonnet'
export const DEFAULT_EFFORT = 'low'
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const MIN_LENGTH_KEY = 'min-length'
export const SILENT_TRIGGERS_KEY = 'silent-triggers'
export const MAX_SILENT_TRIGGERS = 10
export const DEFAULT_SILENT_OFF_TRIGGERS: readonly string[] = ['---']
export const SILENT_OFF_TRIGGERS_KEY = 'silent-off-triggers'
export const MODEL_KEY = 'model'
export const EFFORT_KEY = 'effort'
export const UNFOLDED_TOOLS_KEY = 'unfolded-tools'
export const DEFAULT_UNFOLDED_TOOLS: readonly string[] = ['AskUserQuestion', 'Skill', 'Agent']
export const MAX_UNFOLDED_TOOLS = 50

const EXTRA_DEFAULTS = {
  [MIN_LENGTH_KEY]: DEFAULT_MIN_LENGTH,
  [SILENT_TRIGGERS_KEY]: DEFAULT_SILENT_TRIGGERS,
  [SILENT_OFF_TRIGGERS_KEY]: DEFAULT_SILENT_OFF_TRIGGERS,
  [MODEL_KEY]: DEFAULT_MODEL,
  [EFFORT_KEY]: DEFAULT_EFFORT,
  [UNFOLDED_TOOLS_KEY]: DEFAULT_UNFOLDED_TOOLS,
} as const

const EXTRA_PATHS: Record<keyof typeof EXTRA_DEFAULTS, readonly string[]> = {
  [MIN_LENGTH_KEY]: PROMPT_UPGRADE_PATH,
  [SILENT_TRIGGERS_KEY]: PROMPT_UPGRADE_PATH,
  [SILENT_OFF_TRIGGERS_KEY]: PROMPT_UPGRADE_PATH,
  [MODEL_KEY]: PROMPT_UPGRADE_PATH,
  [EFFORT_KEY]: PROMPT_UPGRADE_PATH,
  [UNFOLDED_TOOLS_KEY]: TOOL_FOLD_PATH,
}

export const labelOf = (key: AddedKey): string =>
  isExtraKey(key) ? [...EXTRA_PATHS[key], key].join('.') : [...FLAG_PATHS[key], propOf(key)].join('.')

export type ExtraKey = keyof typeof EXTRA_DEFAULTS

export type AddedKey = FlagKey | ExtraKey

const isExtraKey = (key: AddedKey): key is ExtraKey => key in EXTRA_DEFAULTS

export type SettingValue = boolean | number | string | string[]

const copyOf = (value: number | string | readonly string[]): number | string | string[] =>
  typeof value === 'object' ? [...value] : value

export const defaultOf = (key: AddedKey): SettingValue =>
  isExtraKey(key) ? copyOf(EXTRA_DEFAULTS[key]) : FLAG_DEFAULTS[key]

export const withMissingDefaults = (
  settings: unknown,
): { settings: Record<string, unknown>; added: AddedKey[] } => {
  const root: Record<string, unknown> = isRecord(settings) ? { ...settings } : {}
  const namespace: Record<string, unknown> = isRecord(root[SETTINGS_NAMESPACE])
    ? { ...(root[SETTINGS_NAMESPACE] as Record<string, unknown>) }
    : {}
  const copies = new Set<unknown>([namespace])
  const added: AddedKey[] = []

  const groupIn = (path: readonly string[]): Record<string, unknown> => {
    let node = namespace

    for (const name of path) {
      const child = node[name]

      if (isRecord(child) && copies.has(child)) {
        node = child
      } else {
        const copy: Record<string, unknown> = isRecord(child) ? { ...child } : {}

        copies.add(copy)
        node[name] = copy
        node = copy
      }
    }

    return node
  }

  for (const path of GROUP_PATHS) {
    groupIn(path)
  }

  for (const key of flagKeys) {
    const group = groupIn(FLAG_PATHS[key])

    if (group[propOf(key)] === undefined) {
      group[propOf(key)] = FLAG_DEFAULTS[key]
      added.push(key)
    }
  }

  for (const key of Object.keys(EXTRA_DEFAULTS) as ExtraKey[]) {
    const group = groupIn(EXTRA_PATHS[key])

    if (group[key] === undefined) {
      group[key] = copyOf(EXTRA_DEFAULTS[key])
      added.push(key)
    }
  }

  root[SETTINGS_NAMESPACE] = namespace

  return { settings: root, added }
}

const hasFlag = (source: unknown, key: FlagKey): boolean => typeof groupOf(source, key)?.[propOf(key)] === 'boolean'

export const minLengthOf = (sources: readonly unknown[]): number | undefined => {
  for (const source of sources) {
    const value = upgradeValueOf(source, MIN_LENGTH_KEY)

    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10000) return value
  }

  return undefined
}

const triggersOf = (sources: readonly unknown[], key: string, isEmptyAllowed: boolean): string[] | undefined => {
  for (const source of sources) {
    const value = upgradeValueOf(source, key)

    if (!Array.isArray(value)) continue
    if (isEmptyAllowed && value.length === 0) return []
    const triggers = [
      ...new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(item => item.length >= 1 && item.length <= 32),
      ),
    ].slice(0, MAX_SILENT_TRIGGERS)

    if (triggers.length > 0) return triggers
  }

  return undefined
}

export const silentTriggersOf = (sources: readonly unknown[]): string[] | undefined =>
  triggersOf(sources, SILENT_TRIGGERS_KEY, false)

export const silentOffTriggersOf = (sources: readonly unknown[]): string[] | undefined =>
  triggersOf(sources, SILENT_OFF_TRIGGERS_KEY, true)

export type Effort = (typeof EFFORTS)[number]

export const modelOf = (sources: readonly unknown[]): string | undefined => {
  for (const source of sources) {
    const value = upgradeValueOf(source, MODEL_KEY)

    if (typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 100) return value.trim()
  }

  return undefined
}

export const effortOf = (sources: readonly unknown[]): Effort | undefined => {
  for (const source of sources) {
    const value = upgradeValueOf(source, EFFORT_KEY)

    if (typeof value === 'string' && (EFFORTS as readonly string[]).includes(value.trim())) return value.trim() as Effort
  }

  return undefined
}

export const unfoldedToolsOf = (sources: readonly unknown[]): string[] | undefined => {
  for (const source of sources) {
    const value = groupAt(source, TOOL_FOLD_PATH)?.[UNFOLDED_TOOLS_KEY]

    if (!Array.isArray(value)) continue
    if (value.length === 0) return []
    const tools = [
      ...new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(item => item.length >= 1 && item.length <= 100),
      ),
    ].slice(0, MAX_UNFOLDED_TOOLS)

    if (tools.length > 0) return tools
  }

  return undefined
}

export type ExtraReport = { key: ExtraKey; value: number | string | string[]; from: string }

const extraReader = (key: ExtraKey): ((sources: readonly unknown[]) => number | string | string[] | undefined) => {
  if (key === MIN_LENGTH_KEY) return minLengthOf
  if (key === SILENT_TRIGGERS_KEY) return silentTriggersOf
  if (key === SILENT_OFF_TRIGGERS_KEY) return silentOffTriggersOf
  if (key === MODEL_KEY) return modelOf
  if (key === UNFOLDED_TOOLS_KEY) return unfoldedToolsOf

  return effortOf
}

export const extraKeys = Object.keys(EXTRA_DEFAULTS) as ExtraKey[]

export const describeExtras = (named: readonly (readonly [string, unknown])[]): ExtraReport[] =>
  extraKeys.map(key => {
    const read = extraReader(key)
    const hit = named.find(([, source]) => read([source]) !== undefined)

    return {
      key,
      value: read(named.map(([, source]) => source)) ?? copyOf(EXTRA_DEFAULTS[key]),
      from: hit === undefined ? 'default' : hit[0],
    }
  })

export const flagsOf = (sources: readonly unknown[]): Flags => ({
  'use-tool-fold': isFlagOn(sources, 'use-tool-fold'),
  'use-edit-summary': isFlagOn(sources, 'use-edit-summary'),
  'use-prompt-upgrade': isFlagOn(sources, 'use-prompt-upgrade'),
  'use-questions': isFlagOn(sources, 'use-questions'),
  'use-silent-upgrade': isFlagOn(sources, 'use-silent-upgrade'),
  'skip-silent-trigger': isFlagOn(sources, 'skip-silent-trigger'),
})
