import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { wrapText } from './upgrade-logic'

type World = {
  runs: { command: string; args: string }[]
  clock: ReturnType<typeof mock.clock>
  model: { calls: number; prompts: string[]; systems: string[]; reply: () => string }
  runFails: boolean
  onRun: (() => Promise<unknown>) | null
}

type Options = { use?: boolean; summary?: boolean }

const world = ($: Engine, on: On, options: Options = {}): World => {
  const w: World = {
    runs: [],
    clock: mock.clock(on, { now: 1000 }),
    model: { calls: 0, prompts: [], systems: [], reply: () => 'Fix band timer\nextra' },
    runFails: false,
    onRun: null,
  }

  mock.store(on, {})
  mock.session(on)
  mock.env(on, { USERPROFILE: 'C:/probe' })
  on('settings.read', (_$, e) =>
    ({
      value:
        (e as { source?: string }).source === 'user'
          ? {
              ccChatTweaks: {
                chat: { 'session-rename': { use: options.use ?? true, 'use-haiku-generated-name': options.summary ?? false } },
                prompt: { 'prompt-upgrade': { use: false } },
              },
            }
          : {},
    }) as never,
  )
  on('model.complete', (_$, e) => {
    w.model.calls += 1
    w.model.prompts.push((e as { prompt: string }).prompt)
    w.model.systems.push((e as { system: string }).system)

    return { value: { text: w.model.reply() } } as never
  })
  on('command.run', async (_$, e) => {
    const { command, args } = e as { command: string; args: string }

    w.runs.push({ command, args })
    if (w.onRun !== null) await w.onRun()
    if (w.runFails) throw new Error('rejected')

    return { text: '' } as never
  })
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.log', () => ({ value: undefined }) as never)

  return w
}

const start = ($: Engine, turnId: string, text: string, agentId?: string) =>
  ($.turn as unknown as { start: (e: unknown) => Promise<unknown> }).start({ text, turnId, ...(agentId === undefined ? {} : { agentId }) })

const complete = async ($: Engine, turnId: string, extra: Record<string, unknown> = {}) => {
  await start($, turnId, `prompt ${turnId}`)

  return endOnly($, turnId, extra)
}

const endOnly = ($: Engine, turnId: string, extra: Record<string, unknown> = {}) =>
  ($.turn as unknown as { complete: (e: unknown) => Promise<unknown> }).complete({
    reason: 'answer',
    answer: 'the answer',
    durationMs: 10,
    isAborted: false,
    turnId,
    ...extra,
  })

const settle = async (w: World): Promise<void> => {
  await w.clock.advance(1)
  await w.clock.advance(1)
}

test('with the switch off a turn end runs no rename', async ($, on) => {
  const w = world($, on, { use: false })
  await complete($, 't1')
  await settle(w)

  expect(w.runs).toEqual([])
})

test('a main turn end runs /rename with no name', async ($, on) => {
  const w = world($, on)
  await complete($, 't1')
  await settle(w)

  expect(w.runs).toEqual([{ command: 'rename', args: '' }])
  expect(w.model.calls).toBe(0)
})

test('an aborted main turn also runs /rename', async ($, on) => {
  const w = world($, on)
  await complete($, 't1', { reason: 'aborted', isAborted: true })
  await settle(w)

  expect(w.runs).toEqual([{ command: 'rename', args: '' }])
})

test('a subagent turn end runs no rename', async ($, on) => {
  const w = world($, on)
  await complete($, 't1', { agentId: 'a1' })
  await settle(w)

  expect(w.runs).toEqual([])
})

test('the Haiku name option passes the first line of the model reply as the name', async ($, on) => {
  const w = world($, on, { summary: true })
  await complete($, 't1')
  await settle(w)

  expect(w.model.calls).toBe(1)
  expect(w.model.systems[0]).toContain('written in Korean')
  expect(w.model.systems[0]).toContain('Do not end the title with the word 세션 or session.')
  expect(w.model.systems[0]).toContain('End the title with a verb in the -하기 form')
  expect(w.runs).toEqual([{ command: 'rename', args: 'Fix band timer' }])
})

test('the Haiku name option falls back to no name when the model fails', async ($, on) => {
  const w = world($, on, { summary: true })
  w.model.reply = () => {
    throw new Error('down')
  }
  await complete($, 't1')
  await settle(w)

  expect(w.runs).toEqual([{ command: 'rename', args: '' }])
})

test('a long prompt does not push the answer out of the summary input', async ($, on) => {
  const w = world($, on, { summary: true })
  await start($, 't1', 'p'.repeat(9000))
  await endOnly($, 't1', { answer: 'ANSWER-MARK' })
  await settle(w)

  expect(w.model.prompts).toHaveLength(1)
  expect(w.model.prompts[0]).toContain('ANSWER-MARK')
  expect(w.model.prompts[0]).toContain('p'.repeat(2000))
  expect(w.model.prompts[0]).not.toContain('p'.repeat(2001))
})

test('a subagent turn start does not replace the prompt the summary reads', async ($, on) => {
  const w = world($, on, { summary: true })
  await start($, 't1', 'MAIN-PROMPT')
  await start($, 's1', 'SUB-PROMPT', 'a1')
  await endOnly($, 't1')
  await settle(w)

  expect(w.model.prompts[0]).toContain('MAIN-PROMPT')
  expect(w.model.prompts[0]).not.toContain('SUB-PROMPT')
})

test('a turn end that arrives while a rename runs schedules no second rename', async ($, on) => {
  const w = world($, on)
  w.onRun = async () => {
    w.onRun = null
    await complete($, 'inner')
    await settle(w)
  }
  await complete($, 't1')
  await settle(w)

  expect(w.runs).toEqual([{ command: 'rename', args: '' }])
})

test('after a rejected rename the next turn end runs /rename again', async ($, on) => {
  const w = world($, on)
  w.runFails = true
  await complete($, 't1')
  await settle(w)
  w.runFails = false
  await complete($, 't2')
  await settle(w)

  expect(w.runs).toEqual([
    { command: 'rename', args: '' },
    { command: 'rename', args: '' },
  ])
})

test('a second turn end for the same prompt runs no second rename', async ($, on) => {
  const w = world($, on)
  await complete($, 't1')
  await settle(w)
  await start($, 't1b', '')
  await endOnly($, 't1b')
  await settle(w)

  expect(w.runs).toEqual([{ command: 'rename', args: '' }])
})

test('a continuation turn start with no text keeps the prompt the summary reads', async ($, on) => {
  const w = world($, on, { summary: true })
  await start($, 't1', 'MAIN-PROMPT')
  await start($, 't1b', '')
  await endOnly($, 't1b')
  await settle(w)

  expect(w.model.prompts[0]).toContain('MAIN-PROMPT')
})

test('a new prompt after a rename runs /rename again', async ($, on) => {
  const w = world($, on)
  await complete($, 't1')
  await settle(w)
  await complete($, 't2')
  await settle(w)

  expect(w.runs).toHaveLength(2)
})

test('the summary reads the typed text inside a prompt-upgrade wrapper', async ($, on) => {
  const w = world($, on, { summary: true })
  await start($, 't1', wrapText('TYPED-TEXT', { types: [], todo: false }))
  await endOnly($, 't1')
  await settle(w)

  expect(w.model.prompts[0]).toContain('<user_prompt>\nTYPED-TEXT\n</user_prompt>')
})

test('the Haiku name keeps only the first sentence of the model reply', async ($, on) => {
  const w = world($, on, { summary: true })
  w.model.reply = () => '고정 대기 제거하기. 작업 내용은 UI 테스트다'
  await complete($, 't1')
  await settle(w)

  expect(w.runs).toEqual([{ command: 'rename', args: '고정 대기 제거하기' }])
})
