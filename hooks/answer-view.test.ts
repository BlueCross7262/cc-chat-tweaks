import { expect, test } from 'claude-code/testing'

import { ANSWER_COLORS, answerViewOf } from './answer-view'

const answered = (extra: Record<string, unknown> = {}) => ({
  questions: [],
  answers: { '어디에 둘까?': '새 reference 신설', '범위는?': '파일 포인터 표기' },
  ...extra,
})

test('an answered dialog gives the title and one row per question', () => {
  expect(answerViewOf(answered())).toEqual({
    title: "User answered Claude's questions:",
    rows: [
      { question: '어디에 둘까?', answer: '새 reference 신설' },
      { question: '범위는?', answer: '파일 포인터 표기' },
    ],
    response: null,
  })
})

test('a free text response hides the rows, as the engine row does', () => {
  expect(answerViewOf(answered({ response: '직접 쓴 답' }))).toEqual({
    title: "User answered Claude's questions:",
    rows: [],
    response: '직접 쓴 답',
  })
})

test('a follow-up keeps the rows and the response and says more questions were asked', () => {
  const view = answerViewOf(answered({ followUp: true, response: '더 물어 줘' }))

  expect(view?.title).toBe('User asked Claude for more questions (so far):')
  expect(view?.rows).toHaveLength(2)
  expect(view?.response).toBe('더 물어 줘')
})

test('a follow-up with nothing answered has the short title and no body', () => {
  expect(answerViewOf({ questions: [], answers: {}, followUp: true })).toEqual({
    title: 'User asked Claude for more questions',
    rows: [],
    response: null,
  })
})

test('a result that holds nothing to show is left to the engine', () => {
  expect(answerViewOf({ questions: [], answers: {} })).toBeNull()
  expect(answerViewOf({ questions: [], answers: {}, response: '' })).toBeNull()
})

test('an idle auto-answer is left to the engine', () => {
  expect(answerViewOf(answered({ afkTimeoutMs: 30000 }))).toBeNull()
})

test('an output of another shape is left to the engine', () => {
  expect(answerViewOf(undefined)).toBeNull()
  expect(answerViewOf('text')).toBeNull()
  expect(answerViewOf([])).toBeNull()
  expect(answerViewOf({ questions: [] })).toBeNull()
  expect(answerViewOf({ answers: [] })).toBeNull()
})

test('an answer that is not text is dropped', () => {
  expect(answerViewOf({ answers: { 'a?': 'x', 'b?': 3, 'c?': null } })?.rows).toEqual([{ question: 'a?', answer: 'x' }])
})

test('the three zones get three colours of the cyan family, dimmest to brightest', () => {
  expect(ANSWER_COLORS).toEqual({
    title: 'rgb(95,158,160)',
    question: 'rgb(143,188,203)',
    answer: 'rgb(184,240,255)',
  })
})
