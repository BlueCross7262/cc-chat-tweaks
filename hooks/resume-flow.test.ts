import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

type Row = Record<string, unknown>

type World = {
  clock: ReturnType<typeof mock.clock>
  id: string
  messages: Record<string, Row[]>
  fails: boolean
}

const world = (on: On, messages: Record<string, Row[]>): World => {
  const w: World = { clock: mock.clock(on, { now: 1000 }), id: 's1', messages, fails: false }

  mock.env(on, { USERPROFILE: 'C:/probe' })
  mock.store(on)
  on('settings.read', (_$, e) =>
    ({
      value: (e as { source?: string }).source === 'user' ? { ccChatTweaks: { chat: { 'tool-fold': { use: true } } } } : {},
    }) as never,
  )
  on('session.start', (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  on('session.id', () => ({ value: w.id }) as never)
  on('session.messages', () => {
    if (w.fails) throw new Error('messages are down')

    return { value: w.messages[w.id] ?? [] } as never
  })

  return w
}

const start = ($: Engine) => $.session.start({ cwd: 'C:/probe', surface: null, isInteractive: true })

const doctorText = async ($: Engine): Promise<string> => {
  const result = await $.command.run({
    command: 'tweaks-doctor',
    args: '',
    origin: { kind: 'plugin', name: 'test' },
  } as never)

  return (result as { text?: string }).text ?? ''
}

const asked = (): Row => ({ role: 'user', text: 'prompt', toolUses: [] })
const said = (text: string): Row => ({ role: 'assistant', text, toolUses: [] })
const called = (id: string, tool = 'Read', result?: unknown): Row => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool_use_id: id, tool, input: {}, ...(result === undefined ? {} : { result }) }],
})
const answered = (id: string, isError = false): Row => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: id, text: '', isError }],
})

const edit = { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] }

const resumed: Row[] = [
  asked(),
  called('a'),
  called('b'),
  answered('a'),
  answered('b', true),
  said('done'),
  asked(),
  called('e', 'Edit', edit),
  answered('e'),
  said('done'),
]

const liveRow = (door: 'response' | 'tool-result', id: string) => ({
  door,
  origin: door === 'response' ? { kind: 'model' as const, model: 'test-model' } : { kind: 'tool' as const, tool: 'Read' },
  uuid: `${door}-${id}`,
  message:
    door === 'response'
      ? { type: 'assistant' as const, role: 'assistant' as const, content: [{ type: 'tool_use' as const, id, name: 'Read', input: {} }] }
      : { type: 'user' as const, role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: id, content: 'ok' }] },
})

test('a session resumed at launch folds the calls it loaded from the transcript', async ($, on) => {
  world(on, { s1: resumed })
  await start($)

  const report = await doctorText($)

  expect(report).toContain('runs tracked: 2, pending: no, failed calls: 1, change records: 1')
})

test('a resume inside the running process folds the loaded calls on the next tick', async ($, on) => {
  const w = world(on, { s1: [], s2: resumed })
  await start($)

  expect(await doctorText($)).toContain('runs tracked: 0')

  w.id = 's2'
  await w.clock.advance(600)

  expect(await doctorText($)).toContain('runs tracked: 2, pending: no, failed calls: 1, change records: 1')
})

test('a tick in the same session keeps the runs the live rows built', async ($, on) => {
  const w = world(on, { s1: [] })
  await start($)
  await $.session.append(liveRow('response', 'x'))
  await $.session.append(liveRow('tool-result', 'x'))
  await w.clock.advance(1800)

  expect(await doctorText($)).toContain('runs tracked: 1')
})

test('a session whose messages cannot be read starts with no runs and still tracks live rows', async ($, on) => {
  const w = world(on, { s1: resumed })
  w.fails = true
  await start($)
  await w.clock.advance(600)

  expect(await doctorText($)).toContain('runs tracked: 0')

  await $.session.append(liveRow('response', 'x'))

  expect(await doctorText($)).toContain('runs tracked: 1')
})
