import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, RenderElement } from 'claude-code'

import type { BandState } from '../types'
import {
  addStep,
  CACHE_TTL_MS,
  cacheText,
  elapsedText,
  CONTENT_KINDS,
  isUserOrigin,
  layoutOf,
  measureStep,
  orderOf,
  secondsLeft,
  speedOf,
  usd,
  warnColor,
  contextColor,
  turnCostColor,
  type BandItem,
  type StepEvent,
} from './band-logic'
import { bandOrderOf, flagsOf, SETTINGS_SOURCES, type FlagKey } from './settings'

const BAND_INITIAL: BandState = {
  turnId: null,
  prompts: 0,
  promptAt: null,
  doneAt: null,
  costAtStart: null,
  turnCost: null,
  total: null,
  context: null,
  sum: { tokens: 0, ms: 0 },
  speed: null,
  expiresAt: null,
}

const bandAtom = atom({ plugin: 'cc-chat-tweaks', key: 'band' } as const, BAND_INITIAL)

const bandNowAtom = atom({ plugin: 'cc-chat-tweaks', key: 'bandNow' } as const, 0)

const ITEM_FLAGS: Record<BandItem, FlagKey> = {
  turns: 'use-band-turns',
  elapsed: 'use-band-elapsed',
  speed: 'use-band-speed',
  'turn-cost': 'use-band-turn-cost',
  'session-cost': 'use-band-session-cost',
  context: 'use-band-context',
  cache: 'use-band-cache',
}

const SPEED = '#8b8cf8'
const MONEY = '#4caf6e'
const MUTED = '#8a8f8c'
const CONTEXT = '#5fa8d3'
const CACHE = '#4fb3a9'
const ELAPSED = '#c9a26b'

const ELAPSED_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <circle cx="12" cy="13" r="9" fill="none" stroke="${ELAPSED}" stroke-width="2"/>
    <path d="M12 13V8.5M12 13l3 2M10 2.5h4" fill="none" stroke="${ELAPSED}" stroke-width="1.8" stroke-linecap="round"/></svg>`

const ring = (color: string, glyph: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="${color}" stroke-width="2"/>
    ${glyph}</svg>`

const SPEED_ICON = ring(
  SPEED,
  `<path d="M6.5 15a6 6 0 0 1 11 0" fill="none" stroke="${SPEED}" stroke-width="1.8" stroke-linecap="round"/>
   <path d="M12 15l3-4" stroke="${SPEED}" stroke-width="1.8" stroke-linecap="round"/>`,
)

const moneyIcon = (color: string) =>
  ring(
    color,
    `<text x="12" y="16.5" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="13" font-weight="600" fill="${color}">$</text>`,
  )

const contextIcon = (percent: number) => {
  const c = 2 * Math.PI * 10
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * c

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="${CONTEXT}" stroke-width="2" stroke-linecap="round"
      stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 12 12)"/>
    <g stroke="${CONTEXT}" stroke-width="1.6" stroke-linecap="round">
      <path d="M8.5 9h7M8.5 12h7M8.5 15h4.5"/>
    </g></svg>`
}

const cacheIcon = (color: string) =>
  ring(
    color,
    `<g fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
       <path d="M8.5 6.5h7M8.5 17.5h7"/>
       <path d="M9.5 6.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M14.5 6.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5"/>
     </g>`,
  )

function readSources($: EngineInterface): Promise<unknown[]> {
  return Promise.all(SETTINGS_SOURCES.map(source => $.settings.read({ source })))
}

async function isBandOn($: EngineInterface): Promise<boolean> {
  try {
    return flagsOf(await readSources($))['use-band']
  } catch {
    return false
  }
}

type TurnRef = { turnId: string; agentId?: string | undefined }

async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const fresh = usage.cost?.usd
  const percent = usage.context.percent

  await update($, bandAtom, state => ({
    ...state,
    total: fresh ?? state.total,
    context: percent ?? state.context,
    turnCost: fresh !== undefined && state.costAtStart !== null ? fresh - state.costAtStart : state.turnCost,
  }))
}

async function startTurn($: EngineInterface, turnId: string): Promise<void> {
  await update($, bandAtom, state => ({ ...state, turnId, doneAt: null, sum: { tokens: 0, ms: 0 } }))
}

export async function startPrompt($: EngineInterface, origin: PromptOrigin | undefined): Promise<void> {
  try {
    if (!isUserOrigin(origin?.kind) || !(await isBandOn($))) return

    const promptAt = await $.clock.now()

    await update($, bandAtom, state => ({
      ...state,
      prompts: state.prompts + 1,
      promptAt,
      doneAt: null,
      costAtStart: null,
      turnCost: null,
    }))

    const cost = (await $.session.usage()).cost?.usd ?? 0

    await update($, bandAtom, state => ({ ...state, costAtStart: cost, turnCost: 0 }))
  } catch {
    return
  }
}

const parts = (...nodes: (RenderElement | null)[]): RenderElement[] => nodes.filter((node): node is RenderElement => node !== null)

type BandView = { items: BandItem[]; state: BandState; seconds: number | null; now: number }

async function viewOf($: EngineInterface, hasSurvey: boolean): Promise<BandView | null> {
  if (hasSurvey) return null

  const sources = await readSources($)
  const flags = flagsOf(sources)

  if (!flags['use-band']) return null

  const items = orderOf(bandOrderOf(sources)).filter(item => flags[ITEM_FLAGS[item]])

  if (items.length === 0) return null

  if ((await $.session.turns()) === 0) return null

  const state = await read($, bandAtom)
  await read($, bandNowAtom)

  const now = await $.clock.now()

  return { items, state, seconds: secondsLeft(state.expiresAt, now), now }
}

export function startBandTick($: EngineInterface): void {
  $.clock.every(1000, async () => {
    try {
      const { expiresAt, promptAt, doneAt } = await read($, bandAtom)
      const now = await $.clock.now()
      const isTiming = promptAt !== null && doneAt === null
      const isCounting = expiresAt !== null && now < expiresAt + 1000

      if (!isTiming && !isCounting) return

      await update($, bandNowAtom, () => now)
    } catch {
      return
    }
  })
}

export async function completeBand($: EngineInterface, e: TurnRef): Promise<void> {
  try {
    if (!(await isBandOn($))) return

    await refresh($)

    if (e.agentId === undefined) {
      const now = await $.clock.now()

      await update($, bandAtom, state => ({ ...state, doneAt: now, expiresAt: now + CACHE_TTL_MS }))
    }
  } catch {
    return
  }
}

export const registerBand = (on: Parameters<Register>[0]): void => {
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || !(await isBandOn($))) return yield* next(e)

    try {
      if ((await read($, bandAtom)).turnId !== e.turnId) await startTurn($, e.turnId)
    } catch {}

    const events: StepEvent[] = []
    let tokens: number | null = null
    const stream = next(e)

    for await (const chunk of stream) {
      const isFirstContent = events.length === 0 && CONTENT_KINDS.includes(chunk.kind)

      if (isFirstContent || chunk.kind === 'stop') {
        try {
          events.push({ kind: chunk.kind, at: await $.clock.now() })
          if (chunk.kind === 'stop') tokens = chunk.usage?.output_tokens ?? null
        } catch {
          tokens = null
        }
      }

      yield chunk
    }

    const result = await stream.result

    try {
      const measured = measureStep(events, tokens, result.serverToolUses ?? [])

      if (measured !== null) {
        await update($, bandAtom, state => {
          const sum = addStep(state.sum, measured)

          return { ...state, sum, speed: speedOf(sum, state.speed) }
        })
      }

      await refresh($)
    } catch {
      return result
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await viewOf($, e.props.hasSurvey).catch(() => null)

    if (view === null) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const { items, state, seconds, now } = view
    const turns = state.prompts === 0 ? '—' : String(state.prompts)
    const layout = layoutOf(e.props.bodyColumns)
    const warn = items.includes('cache') ? warnColor(seconds, e.props.isWorking) : null
    const contextWarn = state.context === null ? null : contextColor(state.context)
    const turnCostTint = turnCostColor(state.turnCost, state.total) ?? MONEY
    const icon = (source: string, alt: string) =>
      Svg ? <Svg source={source} alt={alt} width={layout.icon} height={layout.icon} /> : null

    const cell = (item: BandItem): RenderElement[] => {
      switch (item) {
        case 'turns':
          return parts(<Text dimColor>Turn</Text>, <Text bold>{turns}</Text>)
        case 'elapsed':
          return parts(
            icon(ELAPSED_ICON, 'elapsed'),
            <Text bold>{elapsedText(state.promptAt, state.doneAt, now)}</Text>,
          )
        case 'speed':
          return parts(
            icon(SPEED_ICON, 'speed'),
            <Text bold wrap="truncate-end">
              {state.speed === null ? '—' : `${state.speed} tok/s`}
            </Text>,
          )
        case 'turn-cost':
          return parts(
            icon(moneyIcon(turnCostTint), 'turn cost'),
            <Text bold color={turnCostTint}>
              {usd(state.turnCost)}
            </Text>,
          )
        case 'session-cost':
          return parts(icon(moneyIcon(MUTED), 'session cost'), <Text bold>{usd(state.total)}</Text>)
        case 'context':
          return parts(
            state.context === null ? null : icon(contextIcon(state.context), 'context'),
            <Text bold {...(contextWarn ? { color: contextWarn } : {})}>
              {state.context === null ? '—' : `${state.context}%`}
            </Text>,
          )
        case 'cache':
          return parts(
            icon(cacheIcon(warn ?? CACHE), 'cache'),
            <Text bold {...(warn ? { color: warn } : {})}>
              {cacheText(seconds, e.props.isWorking)}
            </Text>,
          )
      }
    }

    const inner = await next(e)

    const mine = (
      <Box
        flexDirection="row"
        alignItems="center"
        columnGap={layout.gap}
        flexWrap="nowrap"
        overflow="hidden"
        paddingX={1}
        {...(warn ? { borderStyle: 'round', borderColor: warn } : {})}
      >
        {items.flatMap((item, at) => [
          ...(at === 0
            ? []
            : [
                <Text key={`${item}-sep`} dimColor>
                  {' | '}
                </Text>,
              ]),
          <Box key={item} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            {cell(item)}
          </Box>,
        ])}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {inner}
        {mine}
      </Box>
    )
  })
}
