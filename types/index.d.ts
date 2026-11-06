export type Call = { id: string; name: string }

export type Run = { id: string; calls: Call[]; isClosed: boolean }

export type Change = { id: string; added: number; removed: number }

export type Timing = { id: string; start: number; end: number }

export type RunState = { runs: Run[]; failed: string[]; done: string[]; changes: Change[]; times: Timing[] }

export type Wrap = { types: string[]; todo: boolean }

declare module 'claude-code' {
  interface PluginState {
    'cc-chat-tweaks': { expanded: string[]; runs: RunState; blink: boolean; charCount: number }
  }
}
