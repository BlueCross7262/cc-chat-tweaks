import type { EngineInterface, RenderElement, RenderInputOf, RenderSurface } from 'claude-code'

import { ANSWER_COLORS, answerViewOf } from './answer-view'

type ToolResultInput = RenderInputOf<'ToolResult', RenderSurface>

const ROW_MARK = '● '
const TREE_FIRST = '  ⎿  '
const TREE_REST = '     '

export function drawAnswer($: EngineInterface, e: ToolResultInput): RenderElement | null {
  const view = e.props.isErrored || e.props.tool !== 'AskUserQuestion' ? null : answerViewOf(e.props.output)

  if (view === null) {
    return null
  }

  const { Box, Text } = $.ui.resolve(e)
  const lines = [
    ...view.rows.map(({ question, answer }) => (
      <Text>
        <Text color={ANSWER_COLORS.question}>
          · {question} →{' '}
        </Text>
        <Text color={ANSWER_COLORS.answer}>{answer}</Text>
      </Text>
    )),
    ...(view.response === null
      ? []
      : [
          <Text>
            <Text color={ANSWER_COLORS.question}>· </Text>
            <Text color={ANSWER_COLORS.answer}>{view.response}</Text>
          </Text>,
        ]),
  ]

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={ANSWER_COLORS.title}>{ROW_MARK}</Text>
        <Text color={ANSWER_COLORS.title}>{view.title}</Text>
      </Box>
      {lines.map((line, index) => (
        <Box key={`answer-${index}`}>
          <Text color="inactive">{index === 0 ? TREE_FIRST : TREE_REST}</Text>
          <Box flexShrink={1}>{line}</Box>
        </Box>
      ))}
    </Box>
  )
}
