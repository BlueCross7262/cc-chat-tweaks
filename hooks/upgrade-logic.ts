import type { Flow, Phase, Question, Wrap } from '../types'
import { countChars } from './char-count-logic'

export const MIN_LEN = 10
export const SKIP_TTL_MS = 5 * 60 * 1000
export const MAX_QUESTIONS = 3
export const MAX_OPTIONS = 5

export const EMPTY_FLOW: Flow = {
  phase: 'idle',
  original: '',
  questions: [],
  answers: {},
  draft: '',
  skipUntil: 0,
  filled: '',
  runId: 0,
  notice: '',
  context: '',
  types: [],
  wrap: null,
  draftWrap: null,
}

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

export const ASK_LOG_PREFIX = 'Prompt ask:'
export const REWRITE_LOG_PREFIX = 'Prompt rewrite:'
export const CLASSIFY_LOG_PREFIX = 'Prompt classify:'
export const ANSWER_LOG_PREFIX = 'Prompt answer:'

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

export const answerLogs = (flow: Flow, max: number): string[] => {
  const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

  return flow.questions.flatMap((q, i) => {
    const picked = flow.answers[String(i)]
    if (picked === undefined) return []

    const row = `${ANSWER_LOG_PREFIX} ${oneLine(q.q)} → ${oneLine(picked)}`

    return [row.length <= max ? row : `${row.slice(0, Math.max(0, max - 3))}...`]
  })
}

export type GateInput = {
  text: string
  originKind: string | undefined
  hasAttachments: boolean
  isEnabled: boolean
  minLen: number
  silentTriggers: readonly string[]
  offTriggers: readonly string[]
  skipTrigger: boolean
  now: number
  flow: Flow
}

export type Gate =
  | { intercept: true; text: string }
  | { intercept: true; off: true; text: string }
  | { intercept: false; reason: string; clearSkip?: true }

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

export const squash = (text: string): string => text.replace(/\s+/g, '')

const MENTION = /(^|\s)@[\w./\\-]+/

const PASTED = /<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content\b[^>]*>/g

export const withoutPasted = (text: string): string => text.replace(PASTED, ' ').trim()

export const decideGate = (g: GateInput): Gate => {
  const text = g.text.trim()
  const hasTrigger = parseTrigger(text, [...g.silentTriggers, ...g.offTriggers]) !== null
  const filled = g.flow.filled ?? ''
  if (!hasTrigger && filled !== '' && squash(text) === filled) {
    return { intercept: false, reason: 'unchanged-draft', clearSkip: true }
  }
  if (g.flow.skipUntil > 0) {
    if (g.now < g.flow.skipUntil && !hasTrigger) {
      return { intercept: false, reason: 'manual-edit', clearSkip: true }
    }
    return decideRest(g, text, true)
  }
  return decideRest(g, text, false)
}

const decideRest = (g: GateInput, text: string, clearSkip: boolean): Gate => {
  const pass = (reason: string): Gate =>
    clearSkip ? { intercept: false, reason, clearSkip: true } : { intercept: false, reason }
  if (!g.isEnabled) return pass('disabled')
  if (g.flow.phase !== 'idle') return pass('busy')
  // UNVERIFIED: only the user's own Enter (origin kind composer) is intercepted; every other origin passes
  if (g.originKind !== 'composer') return pass('origin')
  if (g.hasAttachments) return pass('attachments')
  const stripped = parseTrigger(text, g.silentTriggers)
  const isOff = parseTrigger(text, g.offTriggers) !== null
  const cleaned = isOff ? parseTrigger(text, [...g.offTriggers, ...g.silentTriggers]) : stripped
  if ((cleaned ?? text).startsWith('/')) return pass('slash')
  if ((cleaned ?? text).startsWith('!')) return pass('shell')
  if (MENTION.test(cleaned ?? text)) return pass('mention')
  if (isOff) {
    if (cleaned === null || cleaned === '') return pass('trigger-only')
    return { intercept: true, off: true, text: cleaned }
  }
  if (stripped !== null) {
    if (stripped === '') return pass('trigger-only')
    return { intercept: true, text: stripped }
  }
  if (!g.skipTrigger) return pass('no-trigger')
  if (countChars(text) < g.minLen) return pass('short')
  if (countChars(withoutPasted(text)) < g.minLen) return pass('pasted-only')
  return { intercept: true, text }
}

export const stripFence = (raw: string): string => {
  const s = raw.trim()
  const m = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(s)
  return (m?.[1] ?? s).trim()
}

const asQuestion = (x: unknown): Question | null => {
  if (typeof x !== 'object' || x === null) return null
  const o = x as { q?: unknown; options?: unknown; recommended?: unknown }
  if (typeof o.q !== 'string' || o.q.trim() === '') return null
  if (!Array.isArray(o.options)) return null
  const wanted = typeof o.recommended === 'number' && Number.isInteger(o.recommended) ? o.recommended : -1
  const options: string[] = []
  let recommended: number | undefined
  o.options.forEach((v: unknown, i: number) => {
    if (typeof v !== 'string' || v.trim() === '' || options.length >= MAX_OPTIONS) return
    if (i === wanted) recommended = options.length
    options.push(v.trim())
  })
  if (options.length < 2) return null
  if (recommended === undefined) return { q: o.q.trim(), options }
  const [first] = options.splice(recommended, 1)
  options.unshift(first as string)
  return { q: o.q.trim(), options, recommended: 0 }
}

export const parseQuestions = (raw: string | null): Question[] => {
  if (raw === null) return []
  try {
    const data = JSON.parse(stripFence(raw)) as { questions?: unknown }
    if (!Array.isArray(data.questions)) return []
    const out: Question[] = []
    for (const item of data.questions) {
      const q = asQuestion(item)
      if (q) out.push(q)
      if (out.length === MAX_QUESTIONS) break
    }
    return out
  } catch {
    return []
  }
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

export const isStale = (flow: Flow, id: number): boolean => flow.runId !== id

export const begin = (flow: Flow, original: string, context = ''): Flow => ({
  ...EMPTY_FLOW,
  skipUntil: flow.skipUntil,
  filled: flow.filled ?? '',
  wrap: flow.wrap ?? null,
  runId: flow.runId + 1,
  phase: 'askLoading',
  original,
  context,
})

export const askInput = (flow: Flow): string => {
  const context = !flow.context ? '' : `<context>${flow.context}</context>`
  return `${context}<prompt>${flow.original}</prompt>`
}

export const reset = (flow: Flow): Flow => ({
  ...EMPTY_FLOW,
  skipUntil: flow.skipUntil,
  filled: flow.filled ?? '',
  wrap: flow.wrap ?? null,
  runId: flow.runId + 1,
})

export const toPhase = (flow: Flow, phase: Phase): Flow => ({ ...flow, phase })

export const withQuestions = (flow: Flow, questions: Question[]): Flow => ({
  ...flow,
  questions,
  answers: {},
  phase: questions.length > 0 ? 'questions' : 'rewriteLoading',
})

export const withRecommended = (flow: Flow): Flow => {
  const answers = { ...flow.answers }
  flow.questions.forEach((q, i) => {
    const key = String(i)
    const pick = q.recommended === undefined ? undefined : q.options[q.recommended]
    if (answers[key] === undefined && pick !== undefined) answers[key] = pick
  })

  return { ...flow, answers }
}

export const parseMinLen = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10000 ? value : MIN_LEN

export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}...`

export const rewriteInput = (flow: Flow): string => {
  const lines = flow.questions
    .map((q, i) => {
      const a = flow.answers[String(i)]
      return a === undefined ? null : `Q: ${q.q}\nA: ${a}`
    })
    .filter((l): l is string => l !== null)
  const context = !flow.context ? '' : `<context>${flow.context}</context>`
  const types = flow.types ?? []
  const typed = types.length === 0 ? '' : `<types>${types.join(',')}</types>`
  return `${context}${typed}<prompt>${flow.original}</prompt><answers>${lines.join('\n\n')}</answers>`
}

const WRAPPER_TAG = /<\/?(?:prompt|draft|answers|request|context|types)>/g

export const unwrapDraft = (raw: string): string =>
  raw
    .trim()
    .split(/(<input>[\s\S]*?<\/input>)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(WRAPPER_TAG, '')))
    .join('')
    .trim()

const HANGUL = /[ㄱ-ㆎ가-힣]/
const QUESTION_LINES: readonly string[] = [
  '대화 중에 선택지가 생기면 AskUserQuestion 도구로 나에게 권장안과 함께 질문한다.',
  '권장 보기는 선택지 목록의 맨 앞에 둔다.',
]

type PromptType = (typeof PROMPT_TYPES)[number]

const QUESTION_TYPES: readonly PromptType[] = ['discuss']

const COMMON_LINES: readonly string[] = [
  '충분히 조사한다.',
  '결과나 결론을 첫 줄에 쓴다.',
  '확인한 사실과 추측을 구분해 쓴다.',
  '확인하지 못한 내용은 확인하지 못했다고 쓴다.',
  '요청하지 않은 배경 설명을 쓰지 않는다.',
  '이미 있는 할일 목록 중 이번 프롬프트와 관련없는 항목은 삭제한다.',
  '여러 단계의 작업이면 할일 목록을 먼저 생성하고 순서대로 진행한다.',
]

const TYPE_LINES: Readonly<Record<PromptType, readonly string[]>> = {
  research: [
    '모든 주장에 근거를 붙인다.',
    '근거는 파일 경로와 줄 번호, 실행 결과, 문서 출처 중 하나로 쓴다.',
    '근거가 없는 내용은 추정이라고 표시한다.',
    '근거끼리 충돌하면 충돌한 사실을 그대로 쓴다.',
  ],
  discuss: [
    '권장안 하나를 첫 줄에 쓰고 이유를 그 뒤에 쓴다.',
    '선택지마다 장점과 단점을 한 줄씩 쓴다.',
    '권장안을 고른 기준을 밝힌다.',
  ],
  execute: [
    '완료한 작업, 실패한 작업, 하지 않은 작업을 나눠 쓴다.',
    '바꾼 파일을 경로로 나열한다.',
    '검증 방법과 그 결과를 쓴다.',
    '검증을 실행하지 못했으면 실행하지 못했다고 쓴다.',
  ],
}

const isPromptType = (type: string): type is PromptType => (PROMPT_TYPES as readonly string[]).includes(type)

const typeBlocks = (types: readonly string[]): readonly (readonly string[])[] =>
  [...new Set(types.filter(isPromptType))].map(type =>
    QUESTION_TYPES.includes(type) ? [...TYPE_LINES[type], ...QUESTION_LINES] : TYPE_LINES[type],
  )

const typeTail = (types: readonly string[]): string => {
  const blocks = typeBlocks(types)
  if (blocks.length === 0) return ''

  return [COMMON_LINES, ...blocks].map(lines => lines.join('\n')).join('\n\n')
}

const normalizeLine = (line: string): string => line.replace(/\s+/g, '').replace('나에게', '')

const META_TAGS: readonly string[] = ['<source>', '</source>', '<hard rule>', '</hard rule>']

const META_LINES: readonly string[] = [
  '너는 프롬프트 엔지니어다.',
  '아래 <source> 는 내가 AI에게 요청하는 내용이다.',
  '<source> 의 요청을 수행하는 프롬프트를 먼저 쓴다.',
  '프롬프트의 작업 부분은 <source> 를 바탕으로 새로 쓴다.',
  '쓴 프롬프트를 채팅에 출력한 후 이 대화에서 그 프롬프트를 실행한다.',
]

const META_FULL_LINES: readonly string[] = [
  ...META_LINES,
  '<hard rule> 의 규칙은 프롬프트를 쓸 때와 실행할 때 모두 지킨다.',
  '<hard rule> 의 규칙 문장만 쓴 프롬프트에 한 글자도 바꾸지 않고 옮긴다.',
  '쓴 프롬프트에는 <source> 태그와 <hard rule> 태그를 포함하지 않는다.',
]

const META_SHORT_LINES: readonly string[] = [...META_LINES, '쓴 프롬프트에는 <source> 태그를 포함하지 않는다.']

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
): { box: string; wrap: Wrap | null } => {
  if (!HANGUL.test(original)) return { box: draft, wrap: null }

  const blocks = typeBlocks(types)
  const hasRules = blocks.length > 0
  const dropped = new Set(
    [...META_FULL_LINES, ...META_SHORT_LINES, ...(hasRules ? [...COMMON_LINES, ...blocks.flat()] : [])].map(normalizeLine),
  )
  const body = tidyBody(
    draft
      .split('\n')
      .filter(line => !dropped.has(normalizeLine(line)))
      .filter(line => !META_TAGS.includes(line.trim()))
      .join('\n'),
  )
  if (META_TAGS.some(tag => body.includes(tag))) return { box: hasRules ? `${body}\n\n${typeTail(types)}` : body, wrap: null }

  return { box: body, wrap: { types: [...new Set(types.filter(isPromptType))] } }
}

export const wrapText = (body: string, wrap: Wrap): string => {
  const hasRules = typeBlocks(wrap.types).length > 0
  const head = (hasRules ? META_FULL_LINES : META_SHORT_LINES).join('\n')
  const source = `<source>\n${body}\n</source>`

  return hasRules ? `${head}\n\n<hard rule>\n${typeTail(wrap.types)}\n</hard rule>\n\n${source}` : `${head}\n\n${source}`
}

export const withMeta = (draft: string, original: string, types: readonly string[]): string => {
  const { box, wrap } = splitMeta(draft, original, types)

  return wrap === null ? box : wrapText(box, wrap)
}

const META_FLAT_LINES: readonly string[] = [...new Set([...META_FULL_LINES, ...META_SHORT_LINES].map(squash))]

const hasMeta = (raw: string): boolean => {
  if (META_TAGS.some(tag => raw.includes(tag))) return true
  const flat = squash(raw)

  return META_FLAT_LINES.some(line => flat.includes(line))
}

const EDIT_MIN_LEN = 5
const EDIT_RATIO = 0.2
const EDIT_CELLS_MAX = 10_000_000

const nearestEdit = (base: string, text: string): number => {
  const n = base.length
  let prev = new Int32Array(n + 1)
  let cur = new Int32Array(n + 1)
  for (let i = 0; i <= n; i += 1) prev[i] = i
  let best = prev[n] as number
  for (let j = 0; j < text.length; j += 1) {
    const code = text.charCodeAt(j)
    cur[0] = 0
    for (let i = 1; i <= n; i += 1) {
      const swap = (prev[i - 1] as number) + (base.charCodeAt(i - 1) === code ? 0 : 1)
      const drop = (prev[i] as number) + 1
      const add = (cur[i - 1] as number) + 1
      cur[i] = Math.min(swap, drop, add)
    }
    if ((cur[n] as number) < best) best = cur[n] as number
    const spare = prev
    prev = cur
    cur = spare
  }

  return best
}

export const wrapLabel = (wrap: Wrap): string => `[+${wrapText('x', wrap).split('\n').length - 1} lines added on send]`

export const isDraftEdit = (base: string, raw: string, cellsMax = EDIT_CELLS_MAX): boolean => {
  if (base.length < EDIT_MIN_LEN) return false
  if (hasMeta(raw)) return false
  const text = squash(raw)
  if (text.includes(base)) return true
  if (base.length * text.length > cellsMax) return false

  return nearestEdit(base, text) <= Math.floor(base.length * EDIT_RATIO)
}

export const withDraft = (flow: Flow, draft: string, notice = ''): Flow => ({
  ...flow,
  draft,
  phase: 'review',
  notice,
})

