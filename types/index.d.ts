export type Call = { id: string; name: string }

export type Run = { id: string; calls: Call[]; isClosed: boolean }

export type Change = { id: string; added: number; removed: number }

export type RunState = { runs: Run[]; failed: string[]; done: string[]; changes: Change[] }

export type Phase = 'idle' | 'askLoading' | 'questions' | 'rewriteLoading' | 'review'

export type Question = { q: string; options: string[]; recommended?: number }

export type Flow = {
  phase: Phase
  original: string
  questions: Question[]
  answers: Record<string, string>
  draft: string
  prevDraft: string
  skipUntil: number
  pending: string | null
  runId: number
  notice: string
  took: { ask: number; rewrite: number; revise: number }
}

declare module 'claude-code' {
  interface PluginState {
    'cc-chat-tweaks': { expanded: string[]; runs: RunState; blink: boolean; flow: Flow }
  }
}
