import { expect, test } from 'claude-code/testing'

import {
  appendLine,
  commonDirOf,
  costSince,
  gitdirOf,
  kstText,
  logPathOf,
  parentOf,
  recordsOf,
  turnLogText,
  turnRecordOf,
  type TurnRecord,
} from './turn-log-logic'

test('reads the gitdir line of a worktree .git file, relative to the folder that holds it', () => {
  expect(gitdirOf('gitdir: D:/repo/.git/worktrees/a\n', 'D:/wt')).toBe('D:/repo/.git/worktrees/a')
  expect(gitdirOf('gitdir: /repo/.git/worktrees/a', '/wt')).toBe('/repo/.git/worktrees/a')
  expect(gitdirOf('gitdir: ../repo/.git/worktrees/a\r\n', 'D:/wt')).toBe('D:/repo/.git/worktrees/a')
  expect(gitdirOf('gitdir: C:\\repo\\.git\\worktrees\\a', 'D:/wt')).toBe('C:/repo/.git/worktrees/a')
  expect(gitdirOf('not a git file', 'D:/wt')).toBeNull()
  expect(gitdirOf('gitdir:   ', 'D:/wt')).toBeNull()
})

test('goes from a worktree gitdir to the common .git through its commondir file', () => {
  expect(commonDirOf('D:/repo/.git/worktrees/a', '../..\n')).toBe('D:/repo/.git')
  expect(commonDirOf('D:/repo/.git/worktrees/a', 'D:/repo/.git')).toBe('D:/repo/.git')
  expect(commonDirOf('D:/repo/.git/worktrees/a', null)).toBe('D:/repo/.git/worktrees/a')
  expect(commonDirOf('D:/repo/.git/worktrees/a', '  ')).toBe('D:/repo/.git/worktrees/a')
})

test('walks up one folder at a time and stops at the root', () => {
  expect(parentOf('D:/a/b')).toBe('D:/a')
  expect(parentOf('D:\\a\\b\\')).toBe('D:\\a')
  expect(parentOf('D:/a')).toBe('D:/')
  expect(parentOf('D:/')).toBeNull()
  expect(parentOf('D:\\')).toBeNull()
  expect(parentOf('/a')).toBe('/')
  expect(parentOf('/')).toBeNull()
})

test('puts one file per session under the log folder', () => {
  expect(logPathOf('D:/repo/.git', 'abc')).toBe('D:/repo/.git/cc-chat-tweaks/turns/abc.jsonl')
  expect(logPathOf('D:\\repo\\.git\\', 'abc')).toBe('D:\\repo\\.git/cc-chat-tweaks/turns/abc.jsonl')
})

test('writes the time in Korea time', () => {
  expect(kstText(Date.UTC(2026, 10, 18, 15, 4, 5, 9))).toBe('2026-11-19T00:04:05.009+09:00')
})

test('the turn cost is what the session spent since the last record', () => {
  expect(costSince(1.5, 1.25)).toBe(0.25)
  expect(costSince(1.5, null)).toBe(1.5)
  expect(costSince(null, 1.25)).toBeNull()
  expect(costSince(1, 1.25)).toBeNull()
})

test('builds one record from a finished turn', () => {
  const record = turnRecordOf({
    at: Date.UTC(2026, 10, 18, 0, 0, 0, 0),
    sessionId: 's1',
    turn: {
      turnId: 't1',
      reason: 'answer',
      durationMs: 1234,
      usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
    },
    costUsd: 0.25,
    sessionCostUsd: 1.5,
    contextPercent: 42,
  })

  expect(record).toEqual({
    at: '2026-11-18T09:00:00.000+09:00',
    sessionId: 's1',
    turnId: 't1',
    agentId: null,
    reason: 'answer',
    durationMs: 1234,
    model: 'claude-opus-5-5',
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheCreationTokens: 40,
    costUsd: 0.25,
    sessionCostUsd: 1.5,
    contextPercent: 42,
  })
})

test('a turn without usage or with a subagent keeps the fields it has and nulls the rest', () => {
  const record = turnRecordOf({
    at: 0,
    sessionId: 's1',
    turn: { turnId: 't2', agentId: 'a1', reason: 'aborted', durationMs: 5 },
    costUsd: null,
    sessionCostUsd: null,
    contextPercent: null,
  })

  expect(record.agentId).toBe('a1')
  expect(record.model).toBeNull()
  expect(record.inputTokens).toBeNull()
  expect(record.outputTokens).toBeNull()
  expect(record.cacheReadTokens).toBeNull()
  expect(record.cacheCreationTokens).toBeNull()
  expect(record.costUsd).toBeNull()
})

test('adds one JSON line at the end and keeps what was there', () => {
  expect(appendLine('', { a: 1 })).toBe('{"a":1}\n')
  expect(appendLine('{"a":1}\n', { a: 2 })).toBe('{"a":1}\n{"a":2}\n')
  expect(appendLine('{"a":1}', { a: 2 })).toBe('{"a":1}\n{"a":2}\n')
})


const row = (over: Partial<TurnRecord>): TurnRecord => ({
  at: '2026-11-18T12:55:21.818+09:00',
  sessionId: 's1',
  turnId: 't1',
  agentId: null,
  reason: 'answer',
  durationMs: 3049,
  model: 'm',
  inputTokens: 2,
  outputTokens: 18,
  cacheReadTokens: 0,
  cacheCreationTokens: 69560,
  costUsd: 0.0139212,
  sessionCostUsd: 0.0139212,
  contextPercent: 7,
  ...over,
})

test('reads the records of a log file and skips lines that are not records', () => {
  const text = `${JSON.stringify(row({}))}\n\nnot json\n[1]\n${JSON.stringify(row({ turnId: 't2' }))}\n`

  expect(recordsOf(text).map(record => record.turnId)).toEqual(['t1', 't2'])
  expect(recordsOf('')).toEqual([])
})

test('draws one row per turn and a total row', () => {
  const text = turnLogText('D:/repo/.git/cc-chat-tweaks/turns/s1.jsonl', [
    row({}),
    row({ at: '2026-11-18T12:56:00.000+09:00', agentId: 'a1', durationMs: 1000, inputTokens: 3, outputTokens: 2, cacheReadTokens: 10, cacheCreationTokens: 0, costUsd: 0.5 }),
  ])

  expect(text).toBe(
    [
      'Turn log: D:/repo/.git/cc-chat-tweaks/turns/s1.jsonl',
      '',
      '| # | at | time | in | out | cache r/w | cost |',
      '|---|---|---|---|---|---|---|',
      '| 1 | 12:55:21 | 3.0s | 2 | 18 | 0/69560 | $0.0139 |',
      '| 2 (sub) | 12:56:00 | 1.0s | 3 | 2 | 10/0 | $0.5000 |',
      '| total | | 4.0s | 5 | 20 | 10/69560 | $0.5139 |',
    ].join('\n'),
  )
})

test('a value the turn does not have is a dash and counts as nothing in the total', () => {
  const text = turnLogText('p', [row({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null, costUsd: null })])

  expect(text).toContain('| 1 | 12:55:21 | 3.0s | — | — | — | — |')
  expect(text).toContain('| total | | 3.0s | 0 | 0 | 0/0 | $0.0000 |')
})

test('a log without turns says so', () => {
  expect(turnLogText('p', [])).toBe('Turn log: p\n\nNo turns yet.')
})
