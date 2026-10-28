import type { EngineInterface, RenderElement, RenderInput, RenderInputOf, RenderSurface } from 'claude-code'

import { ANSWER_COLORS, answerViewOf, declinedViewOf } from './answer-view'

type ToolResultInput = RenderInputOf<'ToolResult', RenderSurface>
type ToolUseInput = RenderInputOf<'ToolUse', RenderSurface>
type Segment = { text: string; color: string }

const ANSWER_TOOL = 'AskUserQuestion'
const ROW_MARK = '● '
const TREE_FIRST = '  ⎿  '
const TREE_REST = '     '

function frame(
  $: EngineInterface,
  e: RenderInput,
  title: string,
  lines: readonly (readonly Segment[])[],
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={ANSWER_COLORS.title}>{ROW_MARK}</Text>
        <Text color={ANSWER_COLORS.title}>{title}</Text>
      </Box>
      {lines.map((segments, index) => (
        <Box key={`line-${index}`}>
          <Text color="inactive">{index === 0 ? TREE_FIRST : TREE_REST}</Text>
          <Box flexShrink={1}>
            <Text>
              {segments.map((segment, at) => (
                <Text key={`segment-${at}`} color={segment.color}>
                  {segment.text}
                </Text>
              ))}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export function drawAnswer($: EngineInterface, e: ToolResultInput): RenderElement | null {
  const view = e.props.isErrored || e.props.tool !== ANSWER_TOOL ? null : answerViewOf(e.props.output)

  if (view === null) {
    return null
  }

  const lines: Segment[][] = view.rows.map(({ question, answer }) => [
    { text: `· ${question} → `, color: ANSWER_COLORS.question },
    { text: answer, color: ANSWER_COLORS.answer },
  ])

  if (view.response !== null) {
    lines.push([
      { text: '· ', color: ANSWER_COLORS.question },
      { text: view.response, color: ANSWER_COLORS.answer },
    ])
  }

  return frame($, e, view.title, lines)
}

export function drawDeclined($: EngineInterface, e: ToolUseInput): RenderElement | null {
  const { tool, input, isErrored, isInterrupted } = e.props
  const view = tool !== ANSWER_TOOL || !isErrored || isInterrupted ? null : declinedViewOf(input)

  if (view === null) {
    return null
  }

  return frame(
    $,
    e,
    view.title,
    view.lines.map(line => [{ text: line, color: ANSWER_COLORS.question }]),
  )
}
