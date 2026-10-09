export type Call = { id: string; name: string }

export type Run = { id: string; calls: Call[]; isClosed: boolean }

export type Change = { id: string; added: number; removed: number }

export type RunState = { runs: Run[]; failed: string[]; done: string[]; changes: Change[] }

declare module 'claude-code' {
  interface PluginState {
    'cc-chat-tweaks': { expanded: string[]; runs: RunState; blink: boolean }
  }
}
