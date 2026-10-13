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
  took: { ask: 0, rewrite: 0, revise: 0 },
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

export type GateInput = {
  text: string
  originKind: string | undefined
  hasAttachments: boolean
  hasTurnId: boolean
  surfaces: readonly string[]
  isEnabled: boolean
  minLen: number
  now: number
  flow: Flow
}

export type Gate =
  | { intercept: true }
  | { intercept: false; reason: string; clearPending?: true; clearSkip?: true }

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
  if (text.startsWith('/')) return pass('slash')
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
  return recommended === undefined ? { q: o.q.trim(), options } : { q: o.q.trim(), options, recommended }
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

export const begin = (flow: Flow, original: string): Flow => ({
  ...EMPTY_FLOW,
  skipUntil: flow.skipUntil,
  pending: flow.pending,
  runId: flow.runId + 1,
  phase: 'askLoading',
  original,
})

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
  return `<prompt>${flow.original}</prompt><answers>${lines.join('\n\n')}</answers>`
}

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
