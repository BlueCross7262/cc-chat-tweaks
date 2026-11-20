import { expect, test } from 'claude-code/testing'

import { NAME_MAX, nameOf } from './auto-rename'

test('nameOf takes the first non-blank line without quotes or a final period, cut to the limit', () => {
  expect(nameOf(null)).toBe('')
  expect(nameOf('')).toBe('')
  expect(nameOf('\n  \r\n ')).toBe('')
  expect(nameOf('\n  "Title."  ')).toBe('Title')
  expect(nameOf("'Band timer fix'")).toBe('Band timer fix')
  expect(nameOf('`밴드 타이머 수정`\n둘째 줄')).toBe('밴드 타이머 수정')
  expect(nameOf('a'.repeat(70))).toBe('a'.repeat(NAME_MAX))
  expect(nameOf('v1.2 release')).toBe('v1.2 release')
})
