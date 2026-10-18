export type Call = { id: string; name: string }

export type Run = { id: string; calls: Call[]; isClosed: boolean }

export type Change = { id: string; added: number; removed: number }

export type Timing = { id: string; start: number; end: number }

export type RunState = { runs: Run[]; failed: string[]; done: string[]; changes: Change[]; times: Timing[] }

export type Phase = 'idle' | 'askLoading' | 'questions' | 'rewriteLoading' | 'review'

export type Question = { q: string; options: string[]; recommended?: number }

export type Flow = {
  phase: Phase
  original: string
  questions: Question[]
  answers: Record<string, string>
  draft: string
  skipUntil: number
  filled: string
  runId: number
  notice: string
  context: string
  types: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'cc-chat-tweaks': { expanded: string[]; runs: RunState; blink: boolean; flow: Flow }
  }
}
