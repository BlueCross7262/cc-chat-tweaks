import { expect, test } from 'claude-code/testing'

import { ANSWER_COLORS, answerViewOf, declinedViewOf } from './answer-view'

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

test('the title and the question are cyan and the answer is amber', () => {
  expect(ANSWER_COLORS).toEqual({
    title: 'rgb(95,158,160)',
    question: 'rgb(143,188,203)',
    answer: 'rgb(255,200,100)',
  })
})

const asked = (...questions: Record<string, unknown>[]) => ({ questions })

test('a declined dialog gives the title and one line per question with its options', () => {
  const input = asked(
    { question: '어떤 기능을 추가할까?', options: [{ label: '리뷰 이력 내보내기' }, { label: '알림 설정 세분화' }] },
    { question: '범위는?', options: [] },
  )

  expect(declinedViewOf(input)).toEqual({
    title: 'User declined to answer questions',
    lines: ['· 어떤 기능을 추가할까? (리뷰 이력 내보내기 / 알림 설정 세분화)', '· 범위는?'],
  })
})

test('a declined question or option of another shape is dropped', () => {
  const input = asked({ question: 'a?', options: [{ label: 'x' }, { label: 3 }, null] }, { question: 5 }, { options: [] })

  expect(declinedViewOf(input)?.lines).toEqual(['· a? (x)'])
})

test('a call input that holds no question is left to the engine', () => {
  expect(declinedViewOf(undefined)).toBeNull()
  expect(declinedViewOf('text')).toBeNull()
  expect(declinedViewOf({})).toBeNull()
  expect(declinedViewOf(asked())).toBeNull()
  expect(declinedViewOf(asked({ question: 5 }))).toBeNull()
})
