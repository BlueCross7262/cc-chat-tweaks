export type Segmenter = { segment: (text: string) => Iterable<unknown> }

export const countGraphemes = (text: string, segmenter: Segmenter): number => [...segmenter.segment(text)].length

export const countCodePoints = (text: string): number => [...text].length

const defaultSegmenter = (): Segmenter | null =>
  typeof Intl === 'object' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null

export const countChars = (text: string, segmenter: Segmenter | null = defaultSegmenter()): number =>
  segmenter === null ? countCodePoints(text) : countGraphemes(text, segmenter)

export const countLabel = (count: number): string => `${count}자`
