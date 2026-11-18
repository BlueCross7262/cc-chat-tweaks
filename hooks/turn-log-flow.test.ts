import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

type World = {
  files: Map<string, string>
  dirs: Set<string>
  cost: number | undefined
  writes: number
  readFails: boolean
}

type Options = { use?: boolean; root?: string; env?: Record<string, string> }

const norm = (path: string): string => path.replace(/\\/g, '/')

const world = ($: Engine, on: On, options: Options = {}): World => {
  const w: World = { files: new Map(), dirs: new Set(), cost: 1, writes: 0, readFails: false }
  const env = options.env ?? { USERPROFILE: 'C:/Users/me' }

  mock.clock(on, { now: Date.UTC(2026, 10, 18, 0, 0, 0, 0) })
  mock.store(on, {})
  on('settings.read', (_$, e) =>
    ({
      value:
        (e as { source?: string }).source === 'user'
          ? { ccChatTweaks: { chat: { 'turn-log': { use: options.use ?? true } }, prompt: { 'prompt-upgrade': { use: false } } } }
          : {},
    }) as never,
  )
  on('session.usage', () =>
    ({
      value: { startedAt: 0, context: { window: 1000, percent: 42 }, rateLimits: [], ...(w.cost === undefined ? {} : { cost: { usd: w.cost } }) },
    }) as never,
  )
  on('session.root', () => ({ value: options.root ?? 'D:/repo' }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  on('env.get', (_$, e) => ({ value: env[(e as { name: string }).name] }) as never)
  on('fs.stat', (_$, e) => {
    const path = norm((e as { path: string }).path)

    if (w.dirs.has(path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never
    if (w.files.has(path)) return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } } as never

    throw new Error('ENOENT')
  })
  on('fs.exists', (_$, e) => ({ value: w.files.has(norm((e as { path: string }).path)) }) as never)
  on('fs.read', (_$, e) => {
    const text = w.files.get(norm((e as { path: string }).path))

    if (text === undefined || w.readFails) throw new Error('ENOENT')

    return { value: text } as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }

    w.writes += 1
    w.files.set(norm(path), text)

    return { value: undefined } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.log', () => ({ value: undefined }) as never)

  return w
}

const complete = ($: Engine, turnId: string, agentId?: string) =>
  ($.turn as unknown as { complete: (e: unknown) => Promise<unknown> }).complete({
    reason: 'answer',
    answer: '',
    durationMs: 1500,
    isAborted: false,
    turnId,
    usage: { model: 'm', input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
    ...(agentId === undefined ? {} : { agentId }),
  })

const linesOf = (w: World, path: string): Record<string, unknown>[] =>
  (w.files.get(path) ?? '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)

const MAIN = 'D:/repo/.git/cc-chat-tweaks/turns/s1.jsonl'

test('with the switch off a turn writes nothing', async ($, on) => {
  const w = world($, on, { use: false })
  w.dirs.add('D:/repo/.git')
  await complete($, 't1')

  expect(w.writes).toBe(0)
})

test('a turn adds one line under the .git folder of the working directory', async ($, on) => {
  const w = world($, on)
  w.dirs.add('D:/repo/.git')
  await complete($, 't1')

  expect(linesOf(w, MAIN)).toEqual([
    {
      at: '2026-11-18T09:00:00.000+09:00',
      sessionId: 's1',
      turnId: 't1',
      agentId: null,
      reason: 'answer',
      durationMs: 1500,
      model: 'm',
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
      costUsd: 1,
      sessionCostUsd: 1,
      contextPercent: 42,
    },
  ])
})

test('the .git folder is found above a working directory inside the repository', async ($, on) => {
  const w = world($, on, { root: 'D:/repo/src/app' })
  w.dirs.add('D:/repo/.git')
  await complete($, 't1')

  expect(linesOf(w, MAIN)).toHaveLength(1)
})

test('a linked worktree writes into the main .git through the gitdir line and commondir', async ($, on) => {
  const w = world($, on, { root: 'D:/wt' })
  w.files.set('D:/wt/.git', 'gitdir: D:/repo/.git/worktrees/wt\n')
  w.files.set('D:/repo/.git/worktrees/wt/commondir', '../..\n')
  await complete($, 't1')

  expect(linesOf(w, MAIN)).toHaveLength(1)
})

test('outside a git repository the file goes under the home .claude folder', async ($, on) => {
  const w = world($, on, { root: 'D:/plain' })
  await complete($, 't1')

  expect(linesOf(w, 'C:/Users/me/.claude/cc-chat-tweaks/turns/s1.jsonl')).toHaveLength(1)
})

test('HOME is the fallback when USERPROFILE is not set', async ($, on) => {
  const w = world($, on, { root: 'D:/plain', env: { HOME: 'C:/home/me' } })
  await complete($, 't1')

  expect(linesOf(w, 'C:/home/me/.claude/cc-chat-tweaks/turns/s1.jsonl')).toHaveLength(1)
})

test('the next turns append, and each cost is what the session spent since the line before', async ($, on) => {
  const w = world($, on)
  w.dirs.add('D:/repo/.git')
  await complete($, 't1')
  w.cost = 1.5
  await complete($, 'sub', 'a1')
  w.cost = 2.25
  await complete($, 't2')

  const lines = linesOf(w, MAIN)

  expect(lines.map(line => [line.turnId, line.agentId, line.costUsd, line.sessionCostUsd])).toEqual([
    ['t1', null, 1, 1],
    ['sub', 'a1', 0.5, 1.5],
    ['t2', null, 0.75, 2.25],
  ])
})

test('an existing file that cannot be read is left as it was', async ($, on) => {
  const w = world($, on)
  w.dirs.add('D:/repo/.git')
  w.files.set(MAIN, '{"old":1}\n')
  w.readFails = true
  await complete($, 't1')

  expect(w.files.get(MAIN)).toBe('{"old":1}\n')
  expect(w.writes).toBe(0)
})

const commandText = async ($: Engine): Promise<string> => {
  const result = (await ($.command as unknown as { run: (input: unknown) => Promise<{ text?: string }> }).run({
    command: 'turn-log',
    args: '',
    origin: { kind: 'plugin', name: 'test' },
  })) as { text?: string }

  return result.text ?? ''
}

test('/turn-log shows the log of this session as a table with a total', async ($, on) => {
  const w = world($, on)
  w.dirs.add('D:/repo/.git')
  await complete($, 't1')
  w.cost = 1.5
  await complete($, 't2')

  const text = await commandText($)

  expect(text).toContain('Turn log: D:/repo/.git/cc-chat-tweaks/turns/s1.jsonl')
  expect(text).toContain('| 1 | 09:00:00 | 1.5s | 1 | 2 | 3/4 | $1.0000 |')
  expect(text).toContain('| 2 | 09:00:00 | 1.5s | 1 | 2 | 3/4 | $0.5000 |')
  expect(text).toContain('| total | | 3.0s | 2 | 4 | 6/8 | $1.5000 |')
})

test('/turn-log names the path and the switch when this session has no log', async ($, on) => {
  const w = world($, on, { use: false })
  w.dirs.add('D:/repo/.git')

  const text = await commandText($)

  expect(text).toContain('No turn log for this session at D:/repo/.git/cc-chat-tweaks/turns/s1.jsonl')
  expect(text).toContain('ccChatTweaks.chat.turn-log.use')
})
