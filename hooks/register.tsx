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
import {
  applyRow,
  changeOf,
  closeRunOnTurnEnd,
  EMPTY_RUN_STATE,
  hasPending,
  headerText,
  isStreamingRow,
  normalizeState,
  recordChange,
  SHOW_ROW,
  viewOf,
  type Header,
} from './runs'
import { formatReport, versionText, type DoctorInput } from './doctor'
import { COMMAND as UPGRADE_COMMAND, COMMAND_HELP, KEY_MIN_LEN, registerUpgrade } from './upgrade'
import { EMPTY_FLOW, MIN_LEN, parseMinLen } from './upgrade-logic'
import {
  describeExtras,
  describeFlags,
  defaultOf,
  flagsOf,
  minLengthOf,
  SETTINGS_SOURCES,
  withMissingDefaults,
  type Flags,
} from './settings'

const DOCTOR_COMMAND = 'tweaks-doctor'
const ROW_MARK = '● '
const FAILED_COLOR = 'rgb(255,153,0)'
const BLINK_MS = 600

const expandedAtom = atom({ plugin: 'cc-chat-tweaks', key: 'expanded' } as const, [])
const runsAtom = atom({ plugin: 'cc-chat-tweaks', key: 'runs' } as const, EMPTY_RUN_STATE)
const blinkAtom = atom({ plugin: 'cc-chat-tweaks', key: 'blink' } as const, true)
const flowAtom = atom({ plugin: 'cc-chat-tweaks', key: 'flow' } as const, EMPTY_FLOW)

type ToolUseInput = RenderInputOf<'ToolUse', RenderSurface>

type SettingsReader = {
  settings: { read: (args: { source: SettingsSource }) => Promise<unknown> }
}

const readFlags = async ($: SettingsReader): Promise<Flags> =>
  flagsOf(await Promise.all(SETTINGS_SOURCES.map(source => $.settings.read({ source }))))

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const register: Register = on => {
  registerUpgrade(on)

  on('session.start', async ($, e, next) => {
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

    await $.command
      .register({
        name: DOCTOR_COMMAND,
        description: 'Check cc-chat-tweaks settings and state, and add missing switches to settings.json with their defaults',
      })
      .catch(() => undefined)

    await $.command.register({ name: UPGRADE_COMMAND, description: COMMAND_HELP }).catch(() => undefined)

    $.clock.every(BLINK_MS, blinkTick)

    return next(e)
  })

  on('command.run', { command: DOCTOR_COMMAND }, async $ => {
    const applied = await applyDefaults($)
    const report = formatReport(await collectDoctorInput($))

    return { text: `${applied}\n\n${report}` }
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
      const updated = closeRunOnTurnEnd(current, e.agentId)

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

    if (flags['use-tool-fold'] && isStreamingRow(await read($, runsAtom), e.props)) {
      const { Box } = $.ui.resolve(e)

      return <Box key={`streaming-${e.props.tool_use_id}`} />
    }

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

  return `Added to ${path}: ${added.map(key => `${key}=${JSON.stringify(defaultOf(key))}`).join(', ')}.`
}

const collectDoctorInput = async ($: EngineInterface): Promise<DoctorInput> => {
  const named = await Promise.all(
    SETTINGS_SOURCES.map(async source => [source, await $.settings.read({ source })] as const),
  )
  const state = normalizeState(await read($, runsAtom))
  const surface = await $.session.surface().then(String, () => 'unknown')
  const version = await $.session.version().then(versionText, () => 'unknown')
  const flow = await read($, flowAtom)
  const stored = parseMinLen(await $.store.get(KEY_MIN_LEN))
  const minLen = minLengthOf(named.map(([, settings]) => settings)) ?? stored
  const extras = describeExtras(named).map(report =>
    report.key === 'min-length' && report.from === 'default'
      ? { ...report, value: stored, from: stored === MIN_LEN ? 'default' : 'threshold command' }
      : report,
  )

  return {
    flags: describeFlags(named),
    extras,
    runs: {
      tracked: state.runs.length,
      pending: hasPending(state),
      failed: state.failed.length,
      changes: state.changes.length,
    },
    upgrade: { phase: flow.phase, minLen },
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
    <Box
      key={`run-box-${stamp}-${header.added}-${header.removed}-${header.failed}`}
      flexDirection="column"
      marginTop={1}
    >
      <Box>
        <Text color={header.isPending ? 'suggestion' : header.failed > 0 ? FAILED_COLOR : 'success'}>
          {isDotOn ? ROW_MARK : '  '}
        </Text>
        <Text>{headerText(header)}</Text>
        {header.failed > 0 ? <Text color={FAILED_COLOR}> {header.failed} failed</Text> : null}
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
