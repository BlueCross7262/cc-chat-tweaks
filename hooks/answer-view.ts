export type AnswerRow = { question: string; answer: string }

export type AnswerView = { title: string; rows: AnswerRow[]; response: string | null }

export const ANSWER_COLORS = {
  title: 'rgb(95,158,160)',
  question: 'rgb(143,188,203)',
  answer: 'rgb(184,240,255)',
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const titleOf = (isFollowUp: boolean, isAnswered: boolean): string => {
  if (!isFollowUp) return "User answered Claude's questions:"

  return isAnswered ? 'User asked Claude for more questions (so far):' : 'User asked Claude for more questions'
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
