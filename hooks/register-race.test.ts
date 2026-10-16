import { expect, mock, test } from 'claude-code/testing'

const doctorText = async ($: { command: { run: (input: never) => Promise<{ text?: string }> } }): Promise<string> => {
  const result = await $.command.run({
    command: 'tweaks-doctor',
    args: '',
    origin: { kind: 'plugin', name: 'test' },
  } as never)

  return result.text ?? ''
}

const callRow = (id: string) => ({
  door: 'response' as const,
  origin: { kind: 'model' as const, model: 'test-model' },
  uuid: `call-${id}`,
  message: {
    type: 'assistant' as const,
    role: 'assistant' as const,
    content: [{ type: 'tool_use' as const, id, name: 'Read', input: {} }],
  },
})

const resultRow = (id: string) => ({
  door: 'tool-result' as const,
  origin: { kind: 'tool' as const, tool: 'Read' },
  uuid: `result-${id}`,
  message: {
    type: 'user' as const,
    role: 'user' as const,
    content: [{ type: 'tool_result' as const, tool_use_id: id, content: 'ok' }],
  },
})

test('a tool result row and a post tool event that arrive together both leave their record', async ($, on) => {
  mock.clock(on)
  mock.session(on)
  mock.env(on, { USERPROFILE: 'C:/probe' })
  mock.store(on)
  on('settings.read', () => ({ value: {} }) as never)
  on('classic.PostToolUse', () => ({}) as never)
  await $.session.append(callRow('a'))

  await Promise.all([
    $.session.append(resultRow('a')),
    $.classic.PostToolUse({
      tool_name: 'Read',
      tool_input: {},
      tool_response: {},
      tool_use_id: 'a',
      duration_ms: 5,
    }),
  ])

  const report = await doctorText($)

  expect(report).toContain('time records: 1, done calls: 1')
})

test('a turn end and a post tool event that arrive together both leave their record', async ($, on) => {
  mock.clock(on)
  mock.session(on)
  mock.env(on, { USERPROFILE: 'C:/probe' })
  mock.store(on)
  on('settings.read', () => ({ value: {} }) as never)
  on('classic.PostToolUse', () => ({}) as never)
  on('turn.complete', () => ({ text: '' }))
  await $.session.append(callRow('a'))
  await $.session.append(resultRow('a'))

  await Promise.all([
    $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' }),
    $.classic.PostToolUse({
      tool_name: 'Read',
      tool_input: {},
      tool_response: {},
      tool_use_id: 'a',
      duration_ms: 5,
    }),
  ])

  const report = await doctorText($)

  expect(report).toContain('time records: 1, done calls: 1')
  expect(report).toContain('pending: no')
})
