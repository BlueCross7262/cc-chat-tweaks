import type { Wrap } from '../types'
import { countChars } from './char-count-logic'

export const MIN_LEN = 10
export const PROMPT_TYPES = ['research', 'discuss', 'execute'] as const

const CONTEXT_TURNS = 6
const CONTEXT_TURN_CLIP = 500
const CONTEXT_TOTAL = 3000

export const buildContext = (turns: readonly { role: string; text: string }[]): string => {
  const lines = turns
    .map(t => ({ role: t.role, text: t.text.trim() }))
    .filter(t => t.text !== '')
    .slice(-CONTEXT_TURNS)
    .map(t => `${t.role}: ${clip(t.text, CONTEXT_TURN_CLIP)}`)
  let total = 0
  const kept: string[] = []
  for (const line of lines.reverse()) {
    if (total + line.length > CONTEXT_TOTAL && kept.length > 0) break
    kept.unshift(line)
    total += line.length + 1
  }

  return kept.join('\n')
}

export const formatMs = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`

export const CLASSIFY_LOG_PREFIX = 'Prompt classify:'

export const classifyTail = (types: readonly string[] | null): string => {
  if (types === null) return 'failed'

  return types.length === 0 ? 'none' : types.join(', ')
}

export const callLog = (
  call: { model: string; effort: string },
  ms: number,
  original: string,
  max: number,
  prefix: string,
): string => {
  const head = `${prefix} ${call.model} ${call.effort} · ${formatMs(ms)}`
  const body = original.replace(/\s+/g, ' ').trim()

  if (body === '') return head

  const room = Math.max(0, max - head.length - 3)
  const shown = body.length <= room ? body : `${body.slice(0, Math.max(0, room - 3))}...`

  return `${head} · ${shown}`
}

export type GateInput = {
  text: string
  originKind: string | undefined
  isEnabled: boolean
  minLen: number
  silentTriggers: readonly string[]
  offTriggers: readonly string[]
  skipTrigger: boolean
}

export type Gate =
  | { intercept: true; text: string }
  | { intercept: true; off: true; text: string }
  | { intercept: true; short: true; text: string }
  | { intercept: false; reason: string }

export const parseTrigger = (text: string, triggers: readonly string[]): string | null => {
  const list = triggers.filter(trigger => trigger !== '').sort((a, b) => b.length - a.length)
  let rest = text.trim()
  let isFound = false
  let isChanged = true
  while (isChanged) {
    isChanged = false
    for (const trigger of list) {
      if (rest.startsWith(trigger)) {
        rest = rest.slice(trigger.length).trimStart()
      } else if (rest.endsWith(trigger)) {
        rest = rest.slice(0, rest.length - trigger.length).trimEnd()
      } else {
        continue
      }
      isChanged = true
      isFound = true
    }
  }

  return isFound ? rest.trim() : null
}

const MENTION = /(^|\s)@[\w./\\-]+/

const PASTED = /<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content\b[^>]*>/g

const withoutPasted = (text: string): string => text.replace(PASTED, ' ')

export const decideGate = (g: GateInput): Gate => {
  const text = g.text.trim()
  const pass = (reason: string): Gate => ({ intercept: false, reason })
  if (!g.isEnabled) return pass('disabled')
  // UNVERIFIED: only the user's own Enter (origin kind composer) is intercepted; every other origin passes
  if (g.originKind !== 'composer') return pass('origin')
  const stripped = parseTrigger(text, g.silentTriggers)
  const isOff = parseTrigger(text, g.offTriggers) !== null
  const cleaned = isOff ? parseTrigger(text, [...g.offTriggers, ...g.silentTriggers]) : stripped
  if ((cleaned ?? text).startsWith('/')) return pass('slash')
  if ((cleaned ?? text).startsWith('!')) return pass('shell')
  if (MENTION.test(withoutPasted(cleaned ?? text))) return pass('mention')
  if (isOff) {
    if (cleaned === null || cleaned === '') return pass('trigger-only')
    return { intercept: true, off: true, text: cleaned }
  }
  if (stripped !== null) {
    if (stripped === '') return pass('trigger-only')
    return { intercept: true, text: stripped }
  }
  if (!g.skipTrigger) return pass('no-trigger')
  if (countChars(text) < g.minLen) return { intercept: true, short: true, text }
  return { intercept: true, text }
}

export const stripFence = (raw: string): string => {
  const s = raw.trim()
  const m = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(s)
  return (m?.[1] ?? s).trim()
}

export const parseTypes = (raw: string | null): string[] => {
  if (raw === null) return []
  try {
    const data = JSON.parse(stripFence(raw)) as { types?: unknown } | null
    if (data === null || !Array.isArray(data.types)) return []
    const known: readonly unknown[] = PROMPT_TYPES

    return [...new Set(data.types.filter(value => known.includes(value)) as string[])]
  } catch {
    return []
  }
}

export const normalizeCompletion = (r: unknown): string | null => {
  if (typeof r === 'string') return r.trim() === '' ? null : r
  if (typeof r !== 'object' || r === null) return null
  const o = r as { isAnswered?: unknown; text?: unknown }
  if (o.isAnswered === false) return null
  if (typeof o.text !== 'string' || o.text.trim() === '') return null
  return o.text
}

export const askInput = (original: string, context = ''): string => {
  const wrapped = context === '' ? '' : `<context>${context}</context>`
  return `${wrapped}<prompt>${original}</prompt>`
}

export const parseMinLen = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10000 ? value : MIN_LEN

export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}...`

const HANGUL = /[ㄱ-ㆎ가-힣]/

export const hasHangul = (text: string): boolean => HANGUL.test(text)
const QUESTION_LINES: readonly string[] = [
  '대화 중에 선택지가 생기면 AskUserQuestion 도구로 나에게 권장안과 함께 질문한다.',
  '권장 보기는 선택지 목록의 맨 앞에 둔다.',
]

type PromptType = (typeof PROMPT_TYPES)[number]

const QUESTION_TYPES: readonly PromptType[] = ['discuss']

const COMMON_LINES: readonly string[] = [
  '원본 데이터에서 확인이 필요 없을 때까지 충분히 조사한다.',
  '결과나 결론을 첫 줄에 쓴다.',
  '확인한 사실과 추측을 구분해 쓴다.',
]

const TODO_LINES: readonly string[] = [
  '이미 있는 할일 목록 중 이번 프롬프트와 관련없는 항목은 삭제한다.',
  '여러 단계의 작업이면 할일 목록을 먼저 생성하고 순서대로 진행한다.',
]

const TYPE_LINES: Readonly<Record<PromptType, readonly string[]>> = {
  research: [
    '모든 주장에 근거를 붙인다.',
    '근거는 파일 경로와 줄 번호, 실행 결과, 문서 출처 중 하나로 쓴다.',
    '근거가 없는 내용은 추정이라고 표시한다.',
    '기억에 의존한 내용은 추정이라고 표시한다.',
    '근거끼리 충돌하면 충돌한 사실을 그대로 쓴다.',
  ],
  discuss: [
    '순서대로 질문하고 질문 전에 쉽게 설명한다.',
    '권장안 하나를 첫 줄에 쓰고 이유를 그 뒤에 쓴다.',
    '권장안을 고른 기준을 밝힌다.',
  ],
  execute: [
    '완료한 작업, 실패한 작업, 하지 않은 작업을 나눠 쓴다.',
    '독립 도구로 완료한 작업을 증명한다.',
  ],
}

const isPromptType = (type: string): type is PromptType => (PROMPT_TYPES as readonly string[]).includes(type)

const typeBlocks = (types: readonly string[]): readonly (readonly string[])[] =>
  [...new Set(types.filter(isPromptType))].map(type =>
    QUESTION_TYPES.includes(type) ? [...TYPE_LINES[type], ...QUESTION_LINES] : TYPE_LINES[type],
  )

const ruleTail = (types: readonly string[], todo: boolean): string =>
  [todo ? [...COMMON_LINES, ...TODO_LINES] : COMMON_LINES, ...typeBlocks(types)].map(lines => lines.join('\n')).join('\n\n')

const normalizeLine = (line: string): string => line.replace(/\s+/g, '').replace('나에게', '')

const META_TAGS: readonly string[] = ['<source>', '</source>', '<hard rule>', '</hard rule>']

const META_LINES: readonly string[] = [
  '너는 프롬프트 엔지니어다.',
  '아래 <source> 는 내가 AI에게 요청하는 내용이다.',
  '<source> 를 이해하고 맥락에 맞게 전문가가 초보자에게 조언하듯 쉽게 프롬프트를 새로 쓴다.',
  '- 요청, 배경, 분석, 목표, 작업 순서, 제약, 출력 형식, 완료 기준 순서로 쓰고 <source> 에 없는 항목은 쓰지 않는다.',
  '- 명사를 동사로 풀어서 쉬운 언어로 쓴다.',
  '쓴 프롬프트를 채팅에 출력한 후 이 대화에서 그 프롬프트대로 응답한다.',
  '이 지시문은 실행 승인이 아니다.',
  '실행할지와 진행 중인 모드를 유지할지는 <source> 만 보고 판단한다.',
]

const RULES_TAIL_LINES: readonly string[] = [
  '<hard rule> 의 규칙 문장만 쓴 프롬프트에 한 글자도 바꾸지 않고 옮긴다.',
  '쓴 프롬프트에는 <source> 태그와 <hard rule> 태그를 포함하지 않는다.',
]

const SHORT_TAIL_LINE = '쓴 프롬프트에는 <source> 태그를 포함하지 않는다.'

const META_FULL_LINES: readonly string[] = [
  ...META_LINES,
  '<hard rule> 의 규칙은 프롬프트를 쓸 때와 응답할 때 모두 지킨다.',
  '진행 중인 모드가 막는 행동은 이 지시문과 <hard rule> 이 시켜도 하지 않는다.',
  ...RULES_TAIL_LINES,
]

const META_SHORT_LINES: readonly string[] = [...META_LINES, SHORT_TAIL_LINE]

const HEADS: readonly { lines: readonly string[]; rules: boolean }[] = [
  { lines: META_FULL_LINES, rules: true },
  { lines: META_SHORT_LINES, rules: false },
]

const HEAD_LINES: readonly string[] = HEADS.flatMap(head => head.lines)

const tidyBody = (text: string): string =>
  text
    .split(/(<input>[\s\S]*?<\/input>)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\n{3,}/g, '\n\n')))
    .join('')
    .trim()

export const splitMeta = (
  draft: string,
  original: string,
  types: readonly string[],
  todo = false,
): { box: string; wrap: Wrap | null } => {
  if (!HANGUL.test(original)) return { box: draft, wrap: null }

  const dropped = new Set(
    [...HEAD_LINES, ...COMMON_LINES, ...(todo ? TODO_LINES : []), ...typeBlocks(types).flat()].map(normalizeLine),
  )
  const body = tidyBody(
    draft
      .split('\n')
      .filter(line => !dropped.has(normalizeLine(line)))
      .filter(line => !META_TAGS.includes(line.trim()))
      .join('\n'),
  )
  if (META_TAGS.some(tag => body.includes(tag))) return { box: `${body}\n\n${ruleTail(types, todo)}`, wrap: null }

  return { box: body, wrap: { types: [...new Set(types.filter(isPromptType))], todo } }
}

export const wrapText = (body: string, wrap: Wrap): string =>
  `${META_FULL_LINES.join('\n')}\n\n<hard rule>\n${ruleTail(wrap.types, wrap.todo)}\n</hard rule>\n\n<source>\n${body}\n</source>`


const SOURCE_OPEN = '<source>\n'
const SOURCE_CLOSE = '\n</source>'
const RULES_OPEN = '<hard rule>\n'
const RULES_CLOSE = '\n</hard rule>\n\n'

export const sourceOf = (text: string): string | null => {
  for (const { lines, rules } of HEADS) {
    const prefix = `${lines.join('\n')}\n\n`
    if (!text.startsWith(prefix)) continue

    let rest = text.slice(prefix.length)
    if (rules) {
      if (!rest.startsWith(RULES_OPEN)) continue
      const end = rest.indexOf(RULES_CLOSE + SOURCE_OPEN)
      if (end < 0) continue
      rest = rest.slice(end + RULES_CLOSE.length)
    }
    if (!rest.startsWith(SOURCE_OPEN) || !rest.endsWith(SOURCE_CLOSE)) continue

    const body = rest.slice(SOURCE_OPEN.length, rest.length - SOURCE_CLOSE.length)

    return body === '' ? null : body
  }

  return null
}

export const withMeta = (draft: string, original: string, types: readonly string[], todo = false): string => {
  const { box, wrap } = splitMeta(draft, original, types, todo)

  return wrap === null ? box : wrapText(box, wrap)
}
