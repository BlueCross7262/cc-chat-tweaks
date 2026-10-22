import { expect, test } from 'claude-code/testing'

import { countChars, countCodePoints, countGraphemes, countLabel } from './char-count-logic'

const FAMILY = '👨‍👩‍👧'
const ACCENT = 'é'
const segmenter = new Intl.Segmenter()

test('counts graphemes as the person sees them', () => {
  expect(countGraphemes('', segmenter)).toBe(0)
  expect(countGraphemes('abc', segmenter)).toBe(3)
  expect(countGraphemes('안녕하세요', segmenter)).toBe(5)
  expect(countGraphemes('😀', segmenter)).toBe(1)
  expect(countGraphemes(FAMILY, segmenter)).toBe(1)
  expect(countGraphemes(ACCENT, segmenter)).toBe(1)
  expect(countGraphemes('a b\n', segmenter)).toBe(4)
})

test('counts code points when no segmenter is given', () => {
  expect(countCodePoints('')).toBe(0)
  expect(countCodePoints('안녕하세요')).toBe(5)
  expect(countCodePoints('😀')).toBe(1)
  expect(countCodePoints(FAMILY)).toBe(5)
  expect(countCodePoints(ACCENT)).toBe(2)
})

test('countChars uses the segmenter it gets and falls back to code points with null', () => {
  expect(countChars(FAMILY, segmenter)).toBe(1)
  expect(countChars(FAMILY, null)).toBe(5)
  expect(countChars(`${ACCENT}안`, null)).toBe(3)
  expect(countChars(`${ACCENT}안`)).toBe(2)
})

test('the label is the count alone', () => {
  expect(countLabel(1)).toBe('1')
  expect(countLabel(123)).toBe('123')
})
