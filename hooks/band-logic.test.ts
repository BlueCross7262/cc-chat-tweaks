import { expect, test } from 'claude-code/testing'

import {
  addStep,
  ALERT_COLOR,
  BAND_ITEMS,
  cacheText,
  layoutOf,
  measureStep,
  orderOf,
  secondsLeft,
  speedOf,
  usd,
  WARN_COLOR,
  warnColor,
  type BandItem,
  type SpeedSum,
} from './band-logic'

const DEFAULT: BandItem[] = ['turns', 'speed', 'turn-cost', 'session-cost', 'context', 'cache']

test('the default order is turns, speed, turn cost, session cost, context, cache', () => {
  expect([...BAND_ITEMS]).toEqual(DEFAULT)
})

test('orderOf puts the listed items first and every missing item after them in the default order', () => {
  expect(orderOf(undefined)).toEqual(DEFAULT)
  expect(orderOf([])).toEqual(DEFAULT)
  expect(orderOf(['cache', 'turns'])).toEqual(['cache', 'turns', 'speed', 'turn-cost', 'session-cost', 'context'])
  expect(orderOf(['speed'])).toEqual(['speed', 'turns', 'turn-cost', 'session-cost', 'context', 'cache'])
  expect(orderOf(['speed', 'turns'])).toEqual(['speed', 'turns', 'turn-cost', 'session-cost', 'context', 'cache'])
  expect(orderOf(['context'])).toEqual(['context', 'turns', 'speed', 'turn-cost', 'session-cost', 'cache'])
})

test('measureStep times a step from its first content chunk to its stop, less the server tool time', () => {
  expect(measureStep([{ kind: 'engine', at: 1000 }, { kind: 'text', at: 3000 }, { kind: 'stop', at: 5000 }], 200, [])).toEqual({ tokens: 200, ms: 2000 })
  expect(measureStep([{ kind: 'text', at: 1000 }, { kind: 'stop', at: 3000 }], 200, [{ startedAt: 1500, endedAt: 1900 }])).toEqual({ tokens: 200, ms: 1600 })
  expect(measureStep([{ kind: 'text', at: 1000 }, { kind: 'stop', at: 3000 }], 200, [{ startedAt: 2500 }])).toEqual({ tokens: 200, ms: 1500 })
  expect(measureStep([{ kind: 'engine', at: 1000 }, { kind: 'stop', at: 2000 }], 50, [])).toBeNull()
  expect(measureStep([{ kind: 'text', at: 1000 }], 50, [])).toBeNull()
  expect(measureStep([{ kind: 'text', at: 1000 }, { kind: 'stop', at: 2000 }], null, [])).toBeNull()
})

const speedAfter = (steps: readonly [number, number][]): number | null => {
  let sum: SpeedSum = { tokens: 0, ms: 0 }
  let speed: number | null = null

  for (const [tokens, ms] of steps) {
    sum = addStep(sum, { tokens, ms })
    speed = speedOf(sum, speed)
  }

  return speed
}

test('the speed sums the steps of a turn and keeps the previous value under the floor or over the cap', () => {
  expect(speedAfter([[200, 1600]])).toBe(125)
  expect(speedAfter([[10, 400]])).toBeNull()
  expect(speedAfter([[10, 400], [40, 600]])).toBe(50)
  expect(speedAfter([[300, 50]])).toBeNull()
  expect(speedAfter([[5000, 2000]])).toBeNull()
  expect(speedOf({ tokens: 10, ms: 400 }, 80)).toBe(80)
})

test('the cache text counts minutes and seconds, says expired at zero and dots while a turn runs', () => {
  expect(cacheText(null, false)).toBe('—')
  expect(cacheText(3600, false)).toBe('60:00')
  expect(cacheText(61, false)).toBe('01:01')
  expect(cacheText(0, false)).toBe('expired')
  expect(cacheText(3600, true)).toBe('…')
  expect(cacheText(null, true)).toBe('…')
})

test('the seconds left are floored and never below zero', () => {
  expect(secondsLeft(null, 0)).toBeNull()
  expect(secondsLeft(3600000, 0)).toBe(3600)
  expect(secondsLeft(1500, 0)).toBe(1)
  expect(secondsLeft(999, 0)).toBe(0)
  expect(secondsLeft(-300000, 0)).toBe(0)
})

test('the warning is amber from 20 minutes, red from 10 and none while a turn runs', () => {
  expect(warnColor(1201, false)).toBeNull()
  expect(warnColor(1200, false)).toBe(WARN_COLOR)
  expect(warnColor(601, false)).toBe(WARN_COLOR)
  expect(warnColor(600, false)).toBe(ALERT_COLOR)
  expect(warnColor(600, true)).toBeNull()
  expect(warnColor(null, false)).toBeNull()
  expect(WARN_COLOR).toBe('#e2a94e')
  expect(ALERT_COLOR).toBe('#e0846b')
})

test('the layout narrows the text under 64 cells, the icons under 52 and the gap as the original tiers do', () => {
  expect(layoutOf(78)).toEqual({ isNarrow: false, icon: 22, gap: 3 })
  expect(layoutOf(77)).toEqual({ isNarrow: false, icon: 22, gap: 2 })
  expect(layoutOf(64)).toEqual({ isNarrow: false, icon: 22, gap: 2 })
  expect(layoutOf(63)).toEqual({ isNarrow: true, icon: 22, gap: 2 })
  expect(layoutOf(52)).toEqual({ isNarrow: true, icon: 22, gap: 2 })
  expect(layoutOf(51)).toEqual({ isNarrow: true, icon: 18, gap: 1 })
})

test('money is two decimals and a dash when absent', () => {
  expect(usd(0.25)).toBe('$0.25')
  expect(usd(4.2)).toBe('$4.20')
  expect(usd(null)).toBe('—')
})
