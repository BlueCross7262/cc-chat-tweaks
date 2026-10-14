import type { Flow, Phase, Question } from '../types'

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
  prevDraft: '',
  skipUntil: 0,
  pending: null,
  runId: 0,
  notice: '',
  context: '',
  took: { ask: 0, rewrite: 0, revise: 0 },
}

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

export const withTook = (flow: Flow, key: keyof Flow['took'], ms: number): Flow => ({
  ...flow,
  took: { ...flow.took, [key]: ms },
})

export const tookText = (flow: Flow): string => {
  const parts = [
    flow.took.ask > 0 ? `questions ${formatMs(flow.took.ask)}` : '',
    flow.took.rewrite > 0 ? `rewrite ${formatMs(flow.took.rewrite)}` : '',
    flow.took.revise > 0 ? `last revision ${formatMs(flow.took.revise)}` : '',
  ].filter(part => part !== '')

  return parts.length === 0 ? '' : `Haiku took ${parts.join(' · ')}`
}

export type CallUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

export const usageOf = (r: unknown): CallUsage | null => {
  const usage = typeof r === 'object' && r !== null ? (r as { usage?: unknown }).usage : undefined
  if (typeof usage !== 'object' || usage === null) return null
  const u = usage as Record<string, unknown>

  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite: count(u.cache_creation_input_tokens),
  }
}

export const formatUsd = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`

export const usageLine = (
  label: string,
  call: { model: string; effort: string },
  ms: number,
  usage: CallUsage | null,
  usd: number | undefined,
): string => {
  const parts = [`${call.model} ${call.effort}`, formatMs(ms)]
  if (usage === null) parts.push('tokens unknown')
  else {
    parts.push(`in ${usage.input} · out ${usage.output}`)
    if (usage.cacheRead > 0 || usage.cacheWrite > 0) parts.push(`cache read ${usage.cacheRead} · write ${usage.cacheWrite}`)
  }
  if (usd !== undefined && usd > 0) parts.push(`session cost +${formatUsd(usd)}`)

  return `Prompt Upgrade ${label}: ${parts.join(' · ')}`
}

export type GateInput = {
  text: string
  originKind: string | undefined
  hasAttachments: boolean
  hasTurnId: boolean
  surfaces: readonly string[]
  isEnabled: boolean
  minLen: number
  silentTrigger: string
  now: number
  flow: Flow
}

export type Gate =
  | { intercept: true }
  | { intercept: true; silent: true; text: string }
  | { intercept: false; reason: string; clearPending?: true; clearSkip?: true }

export const parseTrigger = (text: string, trigger: string): string | null => {
  if (trigger === '') return null
  let rest = text.trim()
  if (!rest.startsWith(trigger) && !rest.endsWith(trigger)) return null
  while (rest.startsWith(trigger)) rest = rest.slice(trigger.length).trimStart()
  while (rest.endsWith(trigger)) rest = rest.slice(0, rest.length - trigger.length).trimEnd()

  return rest.trim()
}

export const decideGate = (g: GateInput): Gate => {
  const text = g.text.trim()
  if (g.flow.pending !== null && text === g.flow.pending) {
    return { intercept: false, reason: 'resubmit', clearPending: true }
  }
  if (g.flow.skipUntil > 0) {
    if (g.now < g.flow.skipUntil) return { intercept: false, reason: 'manual-edit', clearSkip: true }
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
  if (g.hasTurnId) return pass('mid-turn')
  if (g.hasAttachments) return pass('attachments')
  const stripped = parseTrigger(text, g.silentTrigger)
  if ((stripped ?? text).startsWith('/')) return pass('slash')
  if (stripped !== null) {
    if (stripped === '') return pass('trigger-only')
    return { intercept: true, silent: true, text: stripped }
  }
  if (text.length < g.minLen) return pass('short')
  if (!g.surfaces.includes('terminal')) return pass('no-terminal')
  return { intercept: true }
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
  pending: flow.pending,
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
  pending: flow.pending,
  runId: flow.runId + 1,
})

export const toPhase = (flow: Flow, phase: Phase): Flow => ({ ...flow, phase })

export const withQuestions = (flow: Flow, questions: Question[]): Flow => ({
  ...flow,
  questions,
  answers: {},
  phase: questions.length > 0 ? 'questions' : 'rewriteLoading',
})

export const answer = (flow: Flow, index: number, value: string): Flow => {
  const v = value.trim()
  const answers = { ...flow.answers }
  if (v === '') delete answers[String(index)]
  else answers[String(index)] = v
  return { ...flow, answers }
}

export const hasRecommended = (flow: Flow): boolean => flow.questions.some(q => q.recommended !== undefined)

export const withRecommended = (flow: Flow): Flow => {
  const answers = { ...flow.answers }
  flow.questions.forEach((q, i) => {
    const key = String(i)
    const pick = q.recommended === undefined ? undefined : q.options[q.recommended]
    if (answers[key] === undefined && pick !== undefined) answers[key] = pick
  })

  return { ...flow, answers }
}

export const answeredCount = (flow: Flow): number => Object.keys(flow.answers).length

export const parseMinLen = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10000 ? value : MIN_LEN

export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}...`

export const allAnswered = (flow: Flow): boolean =>
  flow.questions.length > 0 && answeredCount(flow) >= flow.questions.length

export const rewriteInput = (flow: Flow): string => {
  const lines = flow.questions
    .map((q, i) => {
      const a = flow.answers[String(i)]
      return a === undefined ? null : `Q: ${q.q}\nA: ${a}`
    })
    .filter((l): l is string => l !== null)
  const context = !flow.context ? '' : `<context>${flow.context}</context>`
  return `${context}<prompt>${flow.original}</prompt><answers>${lines.join('\n\n')}</answers>`
}

const WRAPPER_TAG = /<\/?(?:prompt|draft|answers|request|context)>/g

export const unwrapDraft = (raw: string): string =>
  raw
    .trim()
    .split(/(<input>[\s\S]*?<\/input>)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(WRAPPER_TAG, '')))
    .join('')
    .trim()

export const reviseInput = (draft: string, request: string): string =>
  `<draft>${draft}</draft><request>${request}</request>`

export const withDraft = (flow: Flow, draft: string, notice = ''): Flow => ({
  ...flow,
  draft,
  prevDraft: '',
  phase: 'review',
  notice,
})

export const revised = (flow: Flow, draft: string): Flow => ({
  ...flow,
  prevDraft: flow.draft,
  draft,
})

export const undo = (flow: Flow): Flow =>
  flow.prevDraft === '' ? flow : { ...flow, draft: flow.prevDraft, prevDraft: '' }
