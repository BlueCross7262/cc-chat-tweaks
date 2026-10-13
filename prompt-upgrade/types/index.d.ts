export type Phase = 'idle' | 'askLoading' | 'questions' | 'rewriteLoading' | 'review'

export type Question = { q: string; options: string[] }

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
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-upgrade': { flow: Flow }
  }
}
