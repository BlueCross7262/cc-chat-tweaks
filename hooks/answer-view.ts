export type AnswerRow = { question: string; answer: string }

export type AnswerView = { title: string; rows: AnswerRow[]; response: string | null }

export type DeclinedView = { title: string; lines: string[] }

export const ANSWER_COLORS = {
  title: 'rgb(95,158,160)',
  question: 'rgb(143,188,203)',
  answer: 'rgb(255,200,100)',
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const DECLINED_TITLE = 'User declined to answer questions'

const labelsOf = (options: unknown): string[] =>
  Array.isArray(options)
    ? options.flatMap(option => (isRecord(option) && typeof option.label === 'string' ? [option.label] : []))
    : []

const declinedLineOf = (item: unknown): string[] => {
  if (!isRecord(item) || typeof item.question !== 'string') return []

  const labels = labelsOf(item.options)

  return [labels.length === 0 ? `· ${item.question}` : `· ${item.question} (${labels.join(' / ')})`]
}

const titleOf = (isFollowUp: boolean, isAnswered: boolean): string => {
  if (!isFollowUp) return "User answered Claude's questions:"

  return isAnswered ? 'User asked Claude for more questions (so far):' : 'User asked Claude for more questions'
}

export const declinedViewOf = (input: unknown): DeclinedView | null => {
  if (!isRecord(input) || !Array.isArray(input.questions)) return null

  const lines = input.questions.flatMap(declinedLineOf)

  return lines.length === 0 ? null : { title: DECLINED_TITLE, lines }
}

export const answerViewOf = (output: unknown): AnswerView | null => {
  if (!isRecord(output) || !isRecord(output.answers) || output.afkTimeoutMs) return null

  const response = typeof output.response === 'string' && output.response !== '' ? output.response : null
  const answers = Object.entries(output.answers)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([question, answer]) => ({ question, answer }))
  const isFollowUp = output.followUp === true
  const isAnswered = response !== null || answers.length > 0

  if (!isFollowUp && !isAnswered) return null

  return {
    title: titleOf(isFollowUp, isAnswered),
    rows: isFollowUp || response === null ? answers : [],
    response,
  }
}
