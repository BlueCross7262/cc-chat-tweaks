import { expect, test } from 'claude-code/testing'

import { R_SYSTEM } from './upgrade-prompts'

const LINKS = ['~하고', '~하며', '~하면서', '~한 뒤', '~해', '~아', '~어']
const LINKED = /(?<![다라냐자])고 |하며 |면서 |한 뒤 |한 후 |[가-힣](해|아|어) [가-힣]+다[.?]$/
const SHAPE = /^[^.?!]+[.?]$/
const MIN_EXAMPLES = 6

const arrowExamples = (): string[] =>
  [...R_SYSTEM.matchAll(/→ 출력 ((?:"[^"]+"\s*)+)/g)].flatMap(match =>
    [...(match[1] ?? '').matchAll(/"([^"]+)"/g)].map(quoted => quoted[1] ?? ''),
  )

const formatExamples = (): string[] => {
  const lines = R_SYSTEM.split('\n')
  const rest = lines.slice(lines.findIndex(line => line.includes('형식 예시')) + 1)
  const end = rest.findIndex(line => line.startsWith('-'))

  return rest.slice(0, end)
}

test('the rewrite prompt defines one thought by its predicate and names the links it forbids', () => {
  for (const link of LINKS) expect(R_SYSTEM).toContain(`"${link}"`)
  expect(R_SYSTEM).toContain('서술어 하나가 말하는')
  expect(R_SYSTEM).toContain('요청이 둘이면 문장도 둘이다')
})

test('every example sentence of the rewrite prompt is one sentence and holds no link', () => {
  const sentences = [...formatExamples(), ...arrowExamples()]
  expect(sentences.length).toBeGreaterThanOrEqual(MIN_EXAMPLES)
  for (const sentence of sentences) {
    expect(SHAPE.test(sentence)).toBe(true)
    expect(LINKED.test(sentence)).toBe(false)
  }
})
