import { expect, test } from 'claude-code/testing'

import {
  countOutput,
  displayPath,
  isEditTool,
  toUnifiedDiff,
  verbOf,
} from './edit-counts'

const PATCH = [
  {
    lines: [' keep', '-old a', '-old b', '+new a', '+new b', '+new c', ' keep'],
  },
]

const PATCH_WITH_RANGE = [
  {
    oldStart: 4,
    oldLines: 4,
    newStart: 4,
    newLines: 5,
    lines: [' keep', '-old a', '-old b', '+new a', '+new b', '+new c', ' keep'],
  },
]

const CWD = 'D:\\Project\\cc-mod'

const flag = (value: unknown) => ({ ccChatTweaks: { chat: { 'use-edit-summary': value } } })

const settingsBySource = (bySource: Record<string, unknown>) => (_$: unknown, e: { source?: string }) => ({
  value: bySource[e.source ?? ''] ?? {},
})

const withSummary = (on: (event: 'settings.read', hook: never) => unknown) =>
  on('settings.read', settingsBySource({ user: flag(true) }) as never)

const ENGINE_ROW = { type: 'Text', props: {}, children: ['engine row'] }

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(item => item.text).join('')

test('counts added and removed lines from the patch', () => {
  expect(countOutput({ structuredPatch: PATCH })).toEqual({ added: 3, removed: 2 })
})

test('counts the content lines of a new file', () => {
  expect(countOutput({ type: 'create', content: 'a\nb\nc', structuredPatch: [] })).toEqual({
    added: 3,
    removed: 0,
  })
})

test('counts an empty new file as zero lines', () => {
  expect(countOutput({ type: 'create', content: '', structuredPatch: [] })).toEqual({
    added: 0,
    removed: 0,
  })
})

test('names a created Write file Write and every other edit Update', () => {
  expect(verbOf('Write', { type: 'create' })).toBe('Write')
  expect(verbOf('Write', { type: 'update' })).toBe('Update')
  expect(verbOf('Edit')).toBe('Update')
})

test('shortens a path inside the working directory and keeps one outside', () => {
  expect(displayPath(`${CWD}\\skills\\ralph\\SKILL.md`, CWD)).toBe('skills\\ralph\\SKILL.md')
  expect(displayPath('C:\\Users\\x\\a.md', CWD)).toBe('C:\\Users\\x\\a.md')
  expect(displayPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
})

test('treats only Edit and Write as edit tools', () => {
  expect(isEditTool('Edit')).toBe(true)
  expect(isEditTool('Write')).toBe(true)
  expect(isEditTool('Read')).toBe(false)
})

test('Edit row stays the engine row while the flag is unset', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  on('settings.read', settingsBySource({}) as never)
  on('ui.render', () => ENGINE_ROW as never)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'u0',
    props: {
      tool_use_id: 'u0',
      tool: 'Edit',
      input: { file_path: `${CWD}\\a.txt` },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { filePath: 'x', structuredPatch: PATCH },
    },
  })

  expect(await texts(ui)).toBe('engine row')
})

test('Edit row stays the engine row while a higher source sets the flag false', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  on('settings.read', settingsBySource({ project: flag(false), user: flag(true) }) as never)
  on('ui.render', () => ENGINE_ROW as never)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'u0b',
    props: {
      tool_use_id: 'u0b',
      tool: 'Edit',
      input: { file_path: `${CWD}\\a.txt` },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { filePath: 'x', structuredPatch: PATCH },
    },
  })

  expect(await texts(ui)).toBe('engine row')
})

test('result row of Edit stays the engine row while the flag is unset', async ($, on) => {
  on('settings.read', settingsBySource({}) as never)
  on('ui.render', () => ENGINE_ROW as never)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'u0c',
    props: { tool_use_id: 'u0c', tool: 'Edit', output: {}, isErrored: false },
  })

  expect(await texts(ui)).toBe('engine row')
})

test('Edit row draws the path and the counts', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  withSummary(on)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'u1',
    props: {
      tool_use_id: 'u1',
      tool: 'Edit',
      input: { file_path: `${CWD}\\skills\\ralph\\SKILL.md` },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { filePath: 'x', structuredPatch: PATCH },
    },
  })

  expect(await texts(ui)).toBe('● Update(skills\\ralph\\SKILL.md) +3 -2')
})

test('Write row of a new file draws Write with its line count', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  withSummary(on)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'u2',
    props: {
      tool_use_id: 'u2',
      tool: 'Write',
      input: { file_path: `${CWD}\\a.txt` },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { type: 'create', filePath: 'x', content: 'a\nb\nc', structuredPatch: [], originalFile: null },
    },
  })

  expect(await texts(ui)).toBe('● Write(a.txt) +3')
})

test('running Edit row draws the head without counts', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  withSummary(on)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'u3',
    props: {
      tool_use_id: 'u3',
      tool: 'Edit',
      input: { file_path: `${CWD}\\a.txt` },
      isRunning: true,
      isErrored: false,
      isInterrupted: false,
    },
  })

  expect(await texts(ui)).toBe('● Update(a.txt)')
})

test('Edit row with no changed lines draws the head without counts', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  withSummary(on)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'u4',
    props: {
      tool_use_id: 'u4',
      tool: 'Edit',
      input: { file_path: `${CWD}\\a.txt` },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { filePath: 'x', structuredPatch: [] },
    },
  })

  expect(await texts(ui)).toBe('● Update(a.txt)')
})

test('empty Write row draws the head without counts', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  withSummary(on)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'u5',
    props: {
      tool_use_id: 'u5',
      tool: 'Write',
      input: { file_path: `${CWD}\\a.txt` },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { type: 'create', filePath: 'x', content: '', structuredPatch: [], originalFile: null },
    },
  })

  expect(await texts(ui)).toBe('● Write(a.txt)')
})

test('pressing the head draws the diff under the row and pressing again hides it', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  withSummary(on)

  const mountHead = (requestId: string) =>
    $.ui.mount({
      plugin: 'cc-chat-tweaks',
      surface: 'terminal',
      component: 'ToolUse',
      requestId,
      props: {
        tool_use_id: 'u6',
        tool: 'Edit',
        input: { file_path: `${CWD}\\a.txt` },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output: { filePath: 'x', structuredPatch: PATCH_WITH_RANGE },
      },
    })

  const head = await mountHead('u6')

  expect(await head.findAll({ type: 'Code' })).toHaveLength(0)

  await head.press({ key: 'diff-u6' })
  expect(await (await mountHead('u6-b')).findAll({ type: 'Code' })).toHaveLength(1)

  await head.press({ key: 'diff-u6' })
  expect(await (await mountHead('u6-c')).findAll({ type: 'Code' })).toHaveLength(0)
})

test('builds a unified diff from the patch hunks', () => {
  expect(toUnifiedDiff({ structuredPatch: PATCH_WITH_RANGE })).toBe(
    '@@ -4,4 +4,5 @@\n keep\n-old a\n-old b\n+new a\n+new b\n+new c\n keep',
  )
})

test('derives the hunk counts when the patch carries none', () => {
  expect(toUnifiedDiff({ structuredPatch: PATCH })).toBe(
    '@@ -1,4 +1,5 @@\n keep\n-old a\n-old b\n+new a\n+new b\n+new c\n keep',
  )
})

test('builds an all-added diff for a new file and nothing for an empty one', () => {
  expect(toUnifiedDiff({ type: 'create', content: 'a\nb\n', structuredPatch: [] })).toBe(
    '@@ -0,0 +1,2 @@\n+a\n+b',
  )
  expect(toUnifiedDiff({ type: 'create', content: '', structuredPatch: [] })).toBe('')
})

test('result row of Edit draws nothing', async ($, on) => {
  withSummary(on)

  const ui = await $.ui.mount({
    plugin: 'cc-chat-tweaks',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'u1',
    props: { tool_use_id: 'u1', tool: 'Edit', output: {}, isErrored: false },
  })

  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
})
