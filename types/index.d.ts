export type Call = { id: string; name: string }

export type Run = { id: string; calls: Call[]; isClosed: boolean }

export type Change = { id: string; added: number; removed: number }

export type Timing = { id: string; start: number; end: number }

export type RunState = { runs: Run[]; failed: string[]; done: string[]; changes: Change[]; times: Timing[] }

export type Wrap = { types: string[]; todo: boolean }

export type BandState = {
  turnId: string | null
  prompts: number
  promptAt: number | null
  doneAt: number | null
  costAtStart: number | null
  turnCost: number | null
  total: number | null
  context: number | null
  sum: { tokens: number; ms: number }
  speed: number | null
  expiresAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cc-chat-tweaks': { expanded: string[]; runs: RunState; blink: boolean; charCount: number; band: BandState; bandNow: number }
  }
}
