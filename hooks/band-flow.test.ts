import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

const PLUGIN = 'cc-chat-tweaks'
const MIN = 60 * 1000

type Server = { startedAt: number; endedAt?: number }

type World = {
  clock: ReturnType<typeof mock.clock>
  cost: number | undefined
  percent: number | undefined
  turns: number
  usageFails: boolean
  usageCalls: number
  tokens: number
  server: Server[]
}

type Options = { band?: Record<string, unknown> | null; withUsage?: boolean }

const world = ($: Engine, on: On, options: Options = {}): World => {
  const w: World = {
    clock: mock.clock(on, { now: 1000 }),
    cost: 1,
    percent: 42,
    turns: 3,
    usageFails: false,
    usageCalls: 0,
    tokens: 200,
    server: [],
  }
  const band = options.band === undefined ? {} : options.band
  const chat = band === null ? {} : { band: { use: true, ...band } }

  mock.store(on, {})
  on('settings.read', (_$, e) =>
    ({
      value: (e as { source?: string }).source === 'user' ? { ccChatTweaks: { chat, prompt: { 'prompt-upgrade': { use: false } } } } : {},
    }) as never,
  )
  on('session.turns', () => ({ value: w.turns }) as never)

  if (options.withUsage !== false) {
    on('session.usage', () => {
      w.usageCalls += 1
      if (w.usageFails) throw new Error('usage is down')

      return {
        value: {
          startedAt: 0,
          context: { window: 1000, ...(w.percent === undefined ? {} : { percent: w.percent }) },
          rateLimits: [],
          ...(w.cost === undefined ? {} : { cost: { usd: w.cost } }),
        },
      } as never
    })
  }

  on('turn.step', async function* (_$: unknown, e: unknown) {
    yield { kind: 'text', index: 0, text: 'a' }
    yield {
      kind: 'stop',
      stopReason: 'end_turn',
      usage: { model: 'm', input_tokens: 1, output_tokens: w.tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }

    return {
      turnId: (e as { turnId: string }).turnId,
      index: 0,
      answer: 'a',
      toolUses: [],
      ...(w.server.length === 0 ? {} : { serverToolUses: w.server }),
      stopReason: 'end_turn',
      usage: null,
    }
  } as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['BASE'] }) as never)

  return w
}

const prompt = ($: Engine, kind: 'composer' | 'bridge' | 'task-notification' = 'composer') =>
  $.prompt.submit({ text: 'x', wait: false, origin: { kind } as never })

type StepCall = { turnId: string; index: number; model: string; messageCount: number; agentId?: string }

const stream = ($: Engine, turnId: string, agentId?: string) =>
  ($.turn.step as unknown as (e: StepCall) => AsyncGenerator<{ kind: string }, unknown>)({
    turnId,
    index: 0,
    model: 'm',
    messageCount: 1,
    ...(agentId === undefined ? {} : { agentId }),
  })

type StepPlan = { turnId: string; agentId?: string; wait: number; content: number; costAfter?: number | undefined }

const step = async ($: Engine, w: World, plan: StepPlan): Promise<string[]> => {
  const kinds: string[] = []
  const s = stream($, plan.turnId, plan.agentId)

  await w.clock.advance(plan.wait)
  const first = await s.next()
  if (!first.done) kinds.push(first.value.kind)
  await w.clock.advance(plan.content)
  const second = await s.next()
  if (!second.done) kinds.push(second.value.kind)
  if ('costAfter' in plan) w.cost = plan.costAfter
  const last = await s.next()
  if (!last.done) kinds.push(last.value.kind)

  return kinds
}

const complete = ($: Engine, turnId: string, agentId?: string) =>
  ($.turn as unknown as { complete: (e: unknown) => Promise<unknown> }).complete({
    reason: 'answer',
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId,
    ...(agentId === undefined ? {} : { agentId }),
  })

type Drawn = { texts: string[]; line: string; bordered: { props: Record<string, unknown> }[]; colored: { text: string; color: unknown }[] }

const draw = async ($: Engine, props: Record<string, unknown> = {}): Promise<Drawn> => {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 90, ...props } as never,
  })
  const texts = await ui.findAll({ type: 'Text' })
  const boxes = await ui.findAll({ type: 'Box' })
  await ui.unmount()

  return {
    texts: texts.map(item => item.text),
    line: texts.map(item => item.text).join(' '),
    bordered: boxes.filter(item => item.props.borderColor !== undefined),
    colored: texts.map(item => ({ text: item.text, color: item.props.color })),
  }
}

const inOrder = (line: string, parts: readonly string[]): boolean => {
  let at = -1

  for (const part of parts) {
    const next = line.indexOf(part, at + 1)
    if (next <= at) return false
    at = next
  }

  return true
}

const firstTurn = async ($: Engine, w: World) => {
  await prompt($)
  w.server = [{ startedAt: 4500, endedAt: 4900 }]
  await step($, w, { turnId: 't1', wait: 2000, content: 2000, costAfter: 1.25 })
  w.server = []
  await complete($, 't1')
}

test('the elapsed time runs from the prompt while the turn works and stops at its end', async ($, on) => {
  const w = world($, on)

  expect((await draw($, { isWorking: true })).texts).toContain('--:--')

  await prompt($)
  const s = stream($, 't1')
  await w.clock.advance(65_000)

  expect((await draw($, { isWorking: true })).texts).toContain('01:05')

  await s.next()
  await w.clock.advance(60_000)
  await s.next()
  await s.next()
  await complete($, 't1')
  await w.clock.advance(30_000)

  expect((await draw($)).texts).toContain('02:05')

  await prompt($)
  await w.clock.advance(3000)

  expect((await draw($, { isWorking: true })).texts).toContain('00:03')
})

test('after one turn the band shows turns, speed, turn cost, session cost, context and cache in the default order', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)

  const drawn = await draw($)

  expect(inOrder(drawn.line, ['Turn 1', '125 tok/s', '$0.25', '$1.25', '42%', '60:00'])).toBe(true)
  expect(drawn.texts[0]).toBe('BASE')
})

test('the band keeps what the hooks beneath drew and stacks its own row under it', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)

  const drawn = await draw($)

  expect(drawn.texts.filter(text => text === 'BASE')).toHaveLength(1)
  expect(inOrder(drawn.line, ['BASE', 'Turn 1', '60:00'])).toBe(true)
})

test('the band draws nothing of its own when its switch is off', async ($, on) => {
  const w = world($, on, { band: null })
  await firstTurn($, w)

  expect((await draw($)).texts).toEqual(['BASE'])
})

test('with the band off a turn runs without reading usage', async ($, on) => {
  const w = world($, on, { band: null, withUsage: false })
  const kinds = await step($, w, { turnId: 't1', wait: 10, content: 10 })
  await complete($, 't1')

  expect(kinds).toEqual(['text', 'stop'])
  expect(w.usageCalls).toBe(0)
})

test('a stream the consumer closes early throws nothing and leaves the speed unset', async ($, on) => {
  const w = world($, on)
  const s = stream($, 't1')
  await w.clock.advance(1000)
  await s.next()
  const closed = await s.return(undefined).then(
    () => 'ok',
    (error: unknown) => String(error),
  )

  expect(closed).toBe('ok')
  expect((await draw($)).line).not.toContain('tok/s')
})

test('a usage failure leaves the chunks and the step result as they were', async ($, on) => {
  const w = world($, on)
  w.usageFails = true

  const kinds = await step($, w, { turnId: 't1', wait: 1000, content: 1000 })

  expect(kinds).toEqual(['text', 'stop'])
})

test('the speed of a new turn starts over instead of mixing with the last turn', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  w.tokens = 100
  await step($, w, { turnId: 't2', wait: 1000, content: 2000 })

  expect((await draw($)).line).toContain('50 tok/s')
})

test('a subagent step changes neither the speed nor the costs', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  w.tokens = 900
  await step($, w, { turnId: 'sub', agentId: 'a1', wait: 1000, content: 1000, costAfter: 3 })

  const drawn = await draw($)

  expect(drawn.line).toContain('125 tok/s')
  expect(drawn.line).toContain('$0.25')
  expect(drawn.line).toContain('$1.25')
})

test('a subagent turn end keeps the cache countdown and adds its cost to the turn cost of the prompt', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  await w.clock.advance(30 * MIN)
  w.cost = 2
  await complete($, 'sub', 'a1')

  const drawn = await draw($)

  expect(drawn.line).toContain('30:00')
  expect(drawn.line).toContain('$1.00')
  expect(drawn.line).toContain('$2.00')
})

test('the band hides when every item is off', async ($, on) => {
  const off = { 'use-turns': false, 'use-elapsed': false, 'use-speed': false, 'use-turn-cost': false, 'use-session-cost': false, 'use-context': false, 'use-cache': false }
  const w = world($, on, { band: off })
  await firstTurn($, w)

  expect((await draw($)).texts).toEqual(['BASE'])
})

test('the band hides before the first prompt and under a survey', async ($, on) => {
  const w = world($, on)
  w.turns = 0

  expect((await draw($)).texts).toEqual(['BASE'])

  w.turns = 3

  expect((await draw($, { hasSurvey: true })).texts).toEqual(['BASE'])
})

test('values the usage does not have are dashes, not zeros', async ($, on) => {
  const w = world($, on)
  w.cost = undefined
  w.percent = undefined
  await step($, w, { turnId: 't1', wait: 1000, content: 1000 })

  const drawn = await draw($)

  expect(drawn.texts.filter(text => text === '—').length).toBeGreaterThanOrEqual(2)
  expect(drawn.line).not.toContain('$0.00')
  expect(drawn.line).not.toContain('0%')
})

test('an item switched off is left out and the others stay', async ($, on) => {
  const w = world($, on, { band: { 'use-speed': false } })
  await firstTurn($, w)

  const drawn = await draw($)

  expect(drawn.line).not.toContain('tok/s')
  expect(inOrder(drawn.line, ['Turn 1', '$0.25', '$1.25', '42%', '60:00'])).toBe(true)
})

test('the order setting puts its items first and the rest after them in the default order', async ($, on) => {
  const w = world($, on, { band: { order: ['cache', 'turns'] } })
  await firstTurn($, w)

  expect(inOrder((await draw($)).line, ['60:00', 'Turn 1', '125 tok/s', '$0.25', '$1.25', '42%'])).toBe(true)
})

test('the cache frame turns amber 20 minutes before expiry and red at 10, with the icon and the text in that color', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  await w.clock.advance(40 * MIN + 1000)

  const amber = await draw($)

  expect(amber.bordered.map(box => box.props.borderColor)).toEqual(['#e2a94e'])

  await w.clock.advance(10 * MIN)
  const red = await draw($)

  expect(red.bordered.map(box => box.props.borderColor)).toEqual(['#e0846b'])
  expect(red.bordered[0]?.props.borderStyle).toBe('round')
  expect(red.colored.filter(item => /^\d\d:\d\d$/.test(item.text)).at(-1)?.color).toBe('#e0846b')
})

test('no frame while a turn runs, and the cache text is dots even before the first countdown', async ($, on) => {
  const w = world($, on)

  expect((await draw($, { isWorking: true })).texts).toContain('…')

  await firstTurn($, w)
  await w.clock.advance(55 * MIN)
  const working = await draw($, { isWorking: true })

  expect(working.bordered).toEqual([])
  expect(working.texts).toContain('…')
})

test('no frame when the cache item is off', async ($, on) => {
  const w = world($, on, { band: { 'use-cache': false } })
  await firstTurn($, w)
  await w.clock.advance(50 * MIN + 1000)

  expect((await draw($)).bordered).toEqual([])
})

test('the cache says expired after the hour and never a negative time', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  await w.clock.advance(65 * MIN)

  expect((await draw($)).texts).toContain('expired')
})

test('a narrow band keeps the long turn and speed text', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)

  const narrow = await draw($, { bodyColumns: 40 })

  expect(narrow.line).toContain('Turn 1')
  expect(narrow.line).toContain('125 tok/s')
  expect(narrow.texts).not.toContain('#1')
})

test('a dim | with one space on each side sits between items and not at either end', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)

  const drawn = await draw($)
  const items = drawn.texts.slice(1)

  expect(items.filter(text => text === ' | ').length).toBe(6)
  expect(items[0]).not.toBe(' | ')
  expect(items.at(-1)).not.toBe(' | ')
})

test('the terminal band draws no emoji in place of the icons', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)

  expect((await draw($)).line).not.toMatch(/[⚡⏱⧗]/)
})

test('only a surface that draws svg gets the icon elements', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)

  const svgs = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'AbovePrompt',
      requestId: 'band',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 90 } as never,
    })
    const found = await ui.findAll({ type: 'Svg' })
    await ui.unmount()
    return found.length
  }

  expect(await svgs('terminal')).toBe(0)
  expect(await svgs('desktop')).toBeGreaterThan(0)
})

test('steps of the same turn add up even when a turn start of another turn comes between them', async ($, on) => {
  const w = world($, on)
  w.tokens = 100
  await step($, w, { turnId: 't1', wait: 1000, content: 1000 })
  await ($.turn as unknown as { start: (e: unknown) => Promise<unknown> }).start({ text: 'x', turnId: 'other' })
  w.tokens = 100
  await step($, w, { turnId: 't1', wait: 1000, content: 1000 })

  expect((await draw($)).line).toContain('100 tok/s')
})

test('a prompt sent before any cost is known counts the turn cost from zero', async ($, on) => {
  const w = world($, on)
  w.cost = undefined
  await prompt($)
  await step($, w, { turnId: 't1', wait: 1000, content: 1000, costAfter: 1.25 })
  await complete($, 't1')

  expect(inOrder((await draw($)).line, ['Turn 1', '$1.25', '$1.25'])).toBe(true)
})

test('a usage failure at a prompt leaves that prompt without a turn cost', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  w.usageFails = true
  await prompt($)
  w.usageFails = false
  await step($, w, { turnId: 't2', wait: 1000, content: 1000, costAfter: 1.5 })
  await complete($, 't2')

  const drawn = await draw($)

  expect(drawn.line).toContain('Turn 2')
  expect(drawn.line).not.toContain('$0.25')
  expect(drawn.line).not.toContain('$0.00')
  expect(drawn.line).toContain('$1.50')
})

test('a turn the user did not prompt adds its cost to the last prompt', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  await step($, w, { turnId: 't9', wait: 1000, content: 1000, costAfter: 1.75 })
  await complete($, 't9')

  const drawn = await draw($)

  expect(inOrder(drawn.line, ['Turn 1', '$0.75', '$1.75'])).toBe(true)
})

test('a notification prompt neither counts as a turn nor starts the turn cost over', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  await prompt($, 'task-notification')
  await step($, w, { turnId: 't2', wait: 1000, content: 1000, costAfter: 1.5 })
  await complete($, 't2')

  expect(inOrder((await draw($)).line, ['Turn 1', '$0.50', '$1.50'])).toBe(true)
})

test('a prompt typed at the input or sent through the bridge counts the next turn and starts its cost over', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  await prompt($, 'bridge')
  await step($, w, { turnId: 't2', wait: 1000, content: 1000, costAfter: 1.4 })
  await complete($, 't2')
  await prompt($)
  await step($, w, { turnId: 't3', wait: 1000, content: 1000, costAfter: 1.5 })
  await complete($, 't3')

  expect(inOrder((await draw($)).line, ['Turn 3', '$0.10', '$1.50'])).toBe(true)
})

test('a step whose usage has no cost keeps the last costs', async ($, on) => {
  const w = world($, on)
  await firstTurn($, w)
  await step($, w, { turnId: 't2', wait: 1000, content: 1000, costAfter: undefined })

  const drawn = await draw($)

  expect(inOrder(drawn.line, ['$0.25', '$1.25'])).toBe(true)
})

test('with the band off a prompt reads no usage', async ($, on) => {
  const w = world($, on, { band: null })
  await prompt($)

  expect(w.usageCalls).toBe(0)
})
