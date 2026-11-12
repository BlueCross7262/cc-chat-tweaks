export const BAND_ITEMS = ['turns', 'elapsed', 'speed', 'turn-cost', 'session-cost', 'context', 'cache'] as const

export type BandItem = (typeof BAND_ITEMS)[number]

export const isBandItem = (value: string): value is BandItem => (BAND_ITEMS as readonly string[]).includes(value)

export const orderOf = (listed: readonly BandItem[] | undefined): BandItem[] => {
  const list = listed ?? []

  return [...list, ...BAND_ITEMS.filter(item => !list.includes(item))]
}

export const CONTENT_KINDS: readonly string[] = ['text', 'thinking', 'tool', 'input']

export type StepEvent = { kind: string; at: number }

export type ServerUse = { startedAt: number; endedAt?: number }

export type SpeedSum = { tokens: number; ms: number }

export const measureStep = (
  events: readonly StepEvent[],
  tokens: number | null | undefined,
  serverUses: readonly ServerUse[],
): SpeedSum | null => {
  const start = events.find(event => CONTENT_KINDS.includes(event.kind))?.at
  const end = events.find(event => event.kind === 'stop')?.at

  if (start === undefined || end === undefined || typeof tokens !== 'number') return null

  const server = serverUses.reduce((total, use) => total + ((use.endedAt ?? end) - use.startedAt), 0)

  return { tokens, ms: end - start - server }
}

const STEP_MIN_MS = 100
const MIN_TOKENS = 20
const MIN_MS = 500
const MAX_SPEED = 1000

export const addStep = (sum: SpeedSum, step: SpeedSum): SpeedSum =>
  step.ms < STEP_MIN_MS ? sum : { tokens: sum.tokens + step.tokens, ms: sum.ms + step.ms }

export const speedOf = (sum: SpeedSum, previous: number | null): number | null => {
  if (sum.tokens < MIN_TOKENS || sum.ms < MIN_MS) return previous

  const speed = Math.round(sum.tokens / (sum.ms / 1000))

  return speed <= MAX_SPEED ? speed : previous
}

export const CACHE_TTL_MS = 60 * 60 * 1000

export const secondsLeft = (expiresAt: number | null, now: number): number | null =>
  expiresAt === null ? null : Math.max(0, Math.floor((expiresAt - now) / 1000))

const pad2 = (n: number): string => String(n).padStart(2, '0')

export const NO_TIME = '--:--'

const clock = (seconds: number | null): string =>
  seconds === null || !Number.isFinite(seconds) ? NO_TIME : `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`

export const cacheText = (seconds: number | null, isWorking: boolean): string => {
  if (isWorking) return '…'
  if (seconds === 0) return 'expired'

  return clock(seconds)
}

export const elapsedText = (promptAt: number | null, doneAt: number | null, now: number): string =>
  promptAt === null ? NO_TIME : clock(Math.max(0, Math.floor(((doneAt ?? now) - promptAt) / 1000)))

export const CONTEXT_WARN_COLOR = '#ff8700'
export const CONTEXT_ALERT_COLOR = 'red'

export const contextColor = (percent: number): string | null =>
  percent >= 80 ? CONTEXT_ALERT_COLOR : percent >= 50 ? CONTEXT_WARN_COLOR : null

export const TURN_COST_NOTE_COLOR = 'yellow'

export const turnCostColor = (turnCost: number | null, total: number | null): string | null => {
  if (turnCost === null || total === null || total <= 0) return null

  const ratio = turnCost / total

  if (ratio >= 2) return CONTEXT_ALERT_COLOR
  if (ratio >= 1) return CONTEXT_WARN_COLOR

  return ratio >= 0.5 ? TURN_COST_NOTE_COLOR : null
}

export const WARN_COLOR = '#e2a94e'
export const ALERT_COLOR = '#e0846b'

const WARN_S = 20 * 60
const ALERT_S = 10 * 60

export const warnColor = (seconds: number | null, isWorking: boolean): string | null => {
  if (isWorking || seconds === null) return null
  if (seconds <= ALERT_S) return ALERT_COLOR

  return seconds <= WARN_S ? WARN_COLOR : null
}

export type Layout = { icon: number; gap: number }

export const layoutOf = (columns: number): Layout => ({
  icon: columns < 52 ? 18 : 22,
  gap: 0,
})

export const USER_ORIGINS = ['composer', 'bridge'] as const

export const isUserOrigin = (kind: string | undefined): boolean => USER_ORIGINS.some(origin => origin === kind)

export const usd = (value: number | null): string => (value === null ? '—' : `$${value.toFixed(2)}`)
