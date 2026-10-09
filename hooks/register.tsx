import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  RenderElement,
  RenderInput,
  RenderInputOf,
  RenderSurface,
  SettingsSource,
} from 'claude-code'

import {
  countOutput,
  displayPath,
  isEditTool,
  toUnifiedDiff,
  verbOf,
  type EditOutput,
} from './edit-counts'
import { buildLine, chainPathOf, pickPointer } from './line'
import {
  applyRow,
  changeOf,
  closeOpenRun,
  EMPTY_RUN_STATE,
  hasPending,
  headerText,
  normalizeState,
  recordChange,
  SHOW_ROW,
  viewOf,
  type Header,
} from './runs'
import { formatReport, type DoctorInput } from './doctor'
import {
  describeFlags,
  FLAG_DEFAULTS,
  flagsOf,
  SETTINGS_SOURCES,
  withMissingDefaults,
  type Flags,
} from './settings'

const DOCTOR_COMMAND = 'tweaks-doctor'
const STATE_DIR = '.lmgh'
const ROW_MARK = '● '
const INTERVAL_MS = 2000
const BLINK_MS = 600
const SCAN_EVERY_TICKS = 15
const POINTER_FILE = 'phase-chain-state.json'

const lineAtom = atom({ plugin: 'cc-chat-tweaks', key: 'line' } as const, null)
const expandedAtom = atom({ plugin: 'cc-chat-tweaks', key: 'expanded' } as const, [])
const runsAtom = atom({ plugin: 'cc-chat-tweaks', key: 'runs' } as const, EMPTY_RUN_STATE)
const blinkAtom = atom({ plugin: 'cc-chat-tweaks', key: 'blink' } as const, true)

type ToolUseInput = RenderInputOf<'ToolUse', RenderSurface>

type SettingsReader = {
  settings: { read: (args: { source: SettingsSource }) => Promise<unknown> }
}

const readFlags = async ($: SettingsReader): Promise<Flags> =>
  flagsOf(await Promise.all(SETTINGS_SOURCES.map(source => $.settings.read({ source }))))

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const debugFile = textOf(options.debugFile)
    const failures: string[] = []
    let shown: string | undefined
    let written = ''

    const readJson = async (path: string): Promise<unknown> => {
      try {
        return JSON.parse(await $.fs.read(path))
      } catch (error) {
        failures.push(`${path}: ${messageOf(error)}`)

        return null
      }
    }

    let cachedName = ''
    let ticks = 0

    const quietJson = async (path: string): Promise<unknown> => {
      try {
        return JSON.parse(await $.fs.read(path))
      } catch {
        return null
      }
    }

    const findPointer = async (sessionsDir: string, root: string): Promise<unknown> => {
      if (cachedName !== '') {
        const cached = await quietJson(`${sessionsDir}/${cachedName}/${POINTER_FILE}`)

        if (pickPointer([cached], root) !== null) {
          return cached
        }

        cachedName = ''
      }

      const isScanTick = ticks % SCAN_EVERY_TICKS === 0

      ticks += 1

      if (!isScanTick) {
        return null
      }

      let names: string[] = []

      try {
        const entries = await $.fs.list(sessionsDir)

        names = entries.filter(entry => entry.kind === 'dir').map(entry => entry.name)
      } catch {
        return null
      }

      const pointers = await Promise.all(
        names.map(name => quietJson(`${sessionsDir}/${name}/${POINTER_FILE}`)),
      )
      const picked = pickPointer(pointers, root)
      const index = pointers.indexOf(picked)

      cachedName = index >= 0 ? (names[index] ?? '') : ''

      return picked
    }

    const tick = async (): Promise<void> => {
      let line: string | undefined
      let root = ''
      let sessionId = ''

      failures.length = 0

      try {
        root = textOf(options.projectRoot) || (await $.session.root())
        sessionId = textOf(options.sessionId) || (await $.session.id())
        const sessionsDir = `${root.replace(/\\/g, '/')}/${STATE_DIR}/state/sessions`
        const dir = `${sessionsDir}/${sessionId}`
        let pointer = await readJson(`${dir}/${POINTER_FILE}`)

        if (chainPathOf(pointer) === null) {
          pointer = await findPointer(sessionsDir, root)
        }
        const chainPath = chainPathOf(pointer)
        const chain = chainPath === null ? null : await readJson(chainPath)
        const prd = await readJson(`${dir}/prd.json`)
        const ralph = await readJson(`${dir}/ralph-state.json`)

        line = buildLine({ pointer, chain, prd, ralph })
      } catch (error) {
        failures.push(messageOf(error))
        line = undefined
      }

      if (line !== shown) {
        shown = line
        await update($, lineAtom, () => line ?? null)
      }

      if (debugFile !== '') {
        const snapshot = JSON.stringify({
          line: line ?? null,
          root,
          sessionId,
          failures,
        })

        if (snapshot !== written) {
          written = snapshot

          try {
            await $.fs.write(debugFile, snapshot)
          } catch {
            written = ''
          }
        }
      }
    }

    const blinkTick = async (): Promise<void> => {
      try {
        const isPending = hasPending(await read($, runsAtom))
        const isOn = await read($, blinkAtom)

        if (isPending) {
          await update($, blinkAtom, value => !value)
        } else if (!isOn) {
          await update($, blinkAtom, () => true)
        }
      } catch {
        return
      }
    }

    try {
      await $.command.register({
        name: DOCTOR_COMMAND,
        description: 'Check cc-chat-tweaks settings and state; --apply adds missing switches to settings.json',
        argumentHint: '[--apply]',
      })
    } catch {
      shown = undefined
    }

    $.clock.every(INTERVAL_MS, tick)
    $.clock.every(BLINK_MS, blinkTick)
    void tick()

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, lineAtom)

    if (e.props.hasSurvey || text === null || !(await readFlags($))['use-progress-line']) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>{'❯❯ '}</Text>
        <Text bold color="cyan">
          {text}
        </Text>
      </Box>
    )
  })

  on('command.run', { command: DOCTOR_COMMAND }, async ($, e) => {
    const applied = e.args.trim() === '--apply' ? await applyDefaults($) : null
    const report = formatReport(await collectDoctorInput($, options))

    return { text: applied === null ? report : `${applied}\n\n${report}` }
  })

  on('session.append', async ($, e, next) => {
    try {
      const current = await read($, runsAtom)
      const updated = applyRow(current, {
        door: e.door,
        agentId: e.agentId,
        content: e.message.content,
      })

      if (updated !== current) {
        await update($, runsAtom, () => updated)
      }
    } catch {
      return next(e)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const outcome = await next(e)

    try {
      const change = changeOf(e.tool, e as Record<string, unknown>, (outcome as { result?: unknown }).result)

      if (change !== null) {
        await update($, runsAtom, state => recordChange(state, { id: e.tool_use_id, ...change }))
      }
    } catch {
      return outcome
    }

    return outcome
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const current = await read($, runsAtom)
      const updated = closeOpenRun(current)

      if (updated !== current) {
        await update($, runsAtom, () => updated)
      }
    } catch {
      return next(e)
    }

    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const flags = await readFlags($)
    const view = flags['use-tool-fold']
      ? viewOf(await read($, runsAtom), [e.props.tool_use_id])
      : SHOW_ROW

    if (view.header === null && view.showRow) {
      return drawEditRow($, e, next, flags['use-edit-summary'])
    }

    const row = view.showRow ? await drawEditRow($, e, next, flags['use-edit-summary']) : null
    const stamp = `${e.props.isRunning}-${e.props.output !== undefined}`
    const isDotOn = view.header?.isPending ? await read($, blinkAtom) : true

    return withHeader($, e, view.header, row, stamp, isDotOn)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await readFlags($))['use-tool-fold']) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const flags = await readFlags($)
    const view = flags['use-tool-fold']
      ? viewOf(await read($, runsAtom), [e.props.tool_use_id])
      : SHOW_ROW

    if (view.showRow && !(isEditTool(e.props.tool) && !e.props.isErrored && flags['use-edit-summary'])) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

type PluginOptions = { projectRoot?: unknown; sessionId?: unknown; debugFile?: unknown }

const settingsPathOf = async ($: EngineInterface): Promise<string> => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

  return `${home.replace(/\\/g, '/')}/.claude/settings.json`
}

const applyDefaults = async ($: EngineInterface): Promise<string> => {
  const path = await settingsPathOf($)
  let text = ''

  try {
    text = await $.fs.read(path)
  } catch {
    text = ''
  }

  let parsed: unknown = {}

  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text)
    } catch {
      return `Nothing written: ${path} is not plain JSON (comments or a trailing comma?). Add the switches by hand.`
    }
  }

  const { settings, added } = withMissingDefaults(parsed)

  if (added.length === 0) {
    return `${path} already holds every switch.`
  }

  try {
    await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
  } catch (error) {
    return `Nothing written: ${messageOf(error)}`
  }

  return `Added to ${path}: ${added.map(key => `${key}=${String(FLAG_DEFAULTS[key])}`).join(', ')}.`
}

const collectDoctorInput = async ($: EngineInterface, options: PluginOptions): Promise<DoctorInput> => {
  const named = await Promise.all(
    SETTINGS_SOURCES.map(async source => [source, await $.settings.read({ source })] as const),
  )
  const userSettings = named.find(([source]) => source === 'user')?.[1]
  const root = textOf(options.projectRoot) || (await $.session.root())
  const sessionId = textOf(options.sessionId) || (await $.session.id())
  const pointerPath = `${root.replace(/\\/g, '/')}/${STATE_DIR}/state/sessions/${sessionId}/${POINTER_FILE}`
  let pointerFound = true

  try {
    await $.fs.read(pointerPath)
  } catch {
    pointerFound = false
  }

  const state = normalizeState(await read($, runsAtom))
  const surface = await $.session.surface().then(String, () => 'unknown')
  const version = await $.session.version().then(String, () => 'unknown')

  return {
    flags: describeFlags(named),
    missing: withMissingDefaults(userSettings).added,
    settingsPath: await settingsPathOf($),
    runs: {
      tracked: state.runs.length,
      pending: hasPending(state),
      failed: state.failed.length,
      changes: state.changes.length,
    },
    line: {
      root,
      sessionId,
      pointerFound,
      shown: await read($, lineAtom),
      debugFile: textOf(options.debugFile),
    },
    env: { surface, version },
  }
}

const withHeader = (
  $: EngineInterface,
  e: RenderInput,
  header: Header | null,
  row: RenderElement | null,
  stamp: string,
  isDotOn: boolean,
): RenderElement => {
  const { Box, Text } = $.ui.resolve(e)

  if (header === null) {
    return row ?? <Box key={`hidden-${stamp}`} />
  }

  const hasChanges = header.added > 0 || header.removed > 0

  return (
    <Box key={`run-box-${stamp}-${header.added}-${header.removed}`} flexDirection="column" marginTop={1}>
      <Box>
        <Text color={header.isPending ? 'suggestion' : 'success'}>
          {isDotOn ? ROW_MARK : '  '}
        </Text>
        <Text>{headerText(header)}</Text>
        {hasChanges ? <Text> ...</Text> : null}
        {header.added > 0 ? <Text color="green"> +{header.added}</Text> : null}
        {header.removed > 0 ? <Text color="red"> -{header.removed}</Text> : null}
      </Box>
      {row}
    </Box>
  )
}

const drawEditRow = async (
  $: EngineInterface,
  e: ToolUseInput,
  next: (event: ToolUseInput) => Promise<RenderElement>,
  isSummaryOn: boolean,
): Promise<RenderElement> => {
  const { tool, input, output, isRunning, isErrored, isInterrupted } = e.props

  if (!isEditTool(tool) || isErrored || isInterrupted || !isSummaryOn) {
    return next(e)
  }

  const filePath = (input as { file_path?: string } | null)?.file_path

  if (filePath === undefined) {
    return next(e)
  }

  const { Box, Button, Code, Text } = $.ui.resolve(e)
  const path = displayPath(filePath, await $.session.cwd())
  const result = output as EditOutput | undefined
  const head = `${ROW_MARK}${verbOf(tool, result)}(${path})`
  const counts = result === undefined ? null : countOutput(result)

  if (isRunning || counts === null || (counts.added === 0 && counts.removed === 0)) {
    return (
      <Box>
        <Text bold>{head}</Text>
      </Box>
    )
  }

  const id = e.props.tool_use_id
  const isOpen = (await read($, expandedAtom)).includes(id)
  const diff = isOpen ? toUnifiedDiff(result as EditOutput) : ''
  const toggle = (): void => {
    void update($, expandedAtom, list =>
      list.includes(id) ? list.filter(item => item !== id) : [...list, id],
    )
  }

  return (
    <Box flexDirection="column">
      <Button key={`diff-${id}`} plain onPress={toggle}>
        <Text bold>{head}</Text>
        {counts.added > 0 ? <Text color="green"> +{counts.added}</Text> : null}
        {counts.removed > 0 ? <Text color="red"> -{counts.removed}</Text> : null}
      </Button>
      {diff === '' ? null : <Code source={diff} format="diff" />}
    </Box>
  )
}
