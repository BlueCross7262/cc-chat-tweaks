import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { ANSWER_COLORS } from './answer-view'

const PLUGIN = 'cc-chat-tweaks'
const ENGINE_ROW = 'engine row'
const OUTPUT = {
  questions: [],
  answers: { '어디에 둘까?': '새 reference 신설', '범위는?': '파일 포인터 표기' },
}

const world = (on: On, isOn: boolean): void => {
  mock.store(on, {})
  const chat = { 'answer-colors': { use: isOn } }
  on('settings.read', (_$, e) => ({ value: (e as { source?: string }).source === 'user' ? { ccChatTweaks: { chat } } : {} }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: [ENGINE_ROW] }) as never)
}

type Drawn = { texts: string[]; colored: Record<string, string[]> }

const drawn = async ($: Engine, component: 'ToolResult' | 'ToolUse', props: Record<string, unknown>): Promise<Drawn> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component, requestId: 'q1', props: props as never })
  const found = await ui.findAll({ type: 'Text' })
  const colored: Record<string, string[]> = {}

  for (const item of found) {
    const color = String(item.props.color)

    colored[color] = [...(colored[color] ?? []), item.text]
  }

  await ui.unmount()

  return { texts: found.map(item => item.text), colored }
}

const draw = ($: Engine, output: unknown, tool = 'AskUserQuestion', isErrored = false): Promise<Drawn> =>
  drawn($, 'ToolResult', { tool_use_id: 'q1', tool, output, isErrored, isExpanded: false })

const INPUT = {
  questions: [{ question: '어떤 기능을 추가할까?', options: [{ label: '리뷰 이력 내보내기' }, { label: '알림 설정 세분화' }] }],
}

const drawUse = ($: Engine, extra: Record<string, unknown> = {}): Promise<Drawn> =>
  drawn($, 'ToolUse', {
    tool_use_id: 'q1',
    tool: 'AskUserQuestion',
    input: INPUT,
    isRunning: false,
    isErrored: true,
    isInterrupted: false,
    isExpanded: false,
    ...extra,
  })

test('with the switch on the title, the questions and the answers get their own colours', async ($, on) => {
  world(on, true)
  const { colored } = await draw($, OUTPUT)

  expect(colored[ANSWER_COLORS.title]).toEqual(['● ', "User answered Claude's questions:"])
  expect(colored[ANSWER_COLORS.question]).toEqual(['· 어디에 둘까? → ', '· 범위는? → '])
  expect(colored[ANSWER_COLORS.answer]).toEqual(['새 reference 신설', '파일 포인터 표기'])
})

test('a free text response is drawn in the answer colour', async ($, on) => {
  world(on, true)
  const { colored } = await draw($, { ...OUTPUT, response: '직접 쓴 답' })

  expect(colored[ANSWER_COLORS.question]).toEqual(['· '])
  expect(colored[ANSWER_COLORS.answer]).toEqual(['직접 쓴 답'])
})

test('with the switch off the engine row is drawn', async ($, on) => {
  world(on, false)

  expect((await draw($, OUTPUT)).texts).toEqual([ENGINE_ROW])
})

test('an idle auto-answer, an error and another tool keep the engine row', async ($, on) => {
  world(on, true)

  expect((await draw($, { ...OUTPUT, afkTimeoutMs: 30000 })).texts).toEqual([ENGINE_ROW])
  expect((await draw($, OUTPUT, 'AskUserQuestion', true)).texts).toEqual([ENGINE_ROW])
  expect((await draw($, OUTPUT, 'Bash')).texts).toEqual([ENGINE_ROW])
})

test('a declined dialog is drawn with the title and question colours', async ($, on) => {
  world(on, true)
  const { colored } = await drawUse($)

  expect(colored[ANSWER_COLORS.title]).toEqual(['● ', 'User declined to answer questions'])
  expect(colored[ANSWER_COLORS.question]).toEqual(['· 어떤 기능을 추가할까? (리뷰 이력 내보내기 / 알림 설정 세분화)'])
})

test('a declined dialog keeps the engine row with the switch off', async ($, on) => {
  world(on, false)

  expect((await drawUse($)).texts).toEqual([ENGINE_ROW])
})

test('a call without an error, an aborted call, another tool and an input without questions keep the engine row', async ($, on) => {
  world(on, true)
  expect((await drawUse($, { isErrored: false })).texts).toEqual([ENGINE_ROW])
  expect((await drawUse($, { isInterrupted: true })).texts).toEqual([ENGINE_ROW])
  expect((await drawUse($, { tool: 'Bash' })).texts).toEqual([ENGINE_ROW])
  expect((await drawUse($, { input: {} })).texts).toEqual([ENGINE_ROW])
})
