import { atom, read } from 'claude-code'
import type { EngineInterface, PromptEditResult } from 'claude-code'

import type { Wrap } from '../types'
import { EMPTY_FLOW, isDraftEdit, squash, wrapLabel } from './upgrade-logic'

const flowAtom = atom({ plugin: 'cc-chat-tweaks', key: 'flow' } as const, EMPTY_FLOW)

export type Label = { start: number; end: number; virtualText: string; dimColor: true }

export const labelFor = (wrap: Wrap): Label[] => [{ start: 0, end: 0, virtualText: `${wrapLabel(wrap)}\n`, dimColor: true }]

export async function decorateEdit($: EngineInterface, box: PromptEditResult): Promise<PromptEditResult> {
  try {
    const flow = await read($, flowAtom)
    const wrap = flow.wrap ?? null
    const base = flow.filled ?? ''
    if (wrap === null || box.text === '') return box
    if (squash(box.text) !== base && !isDraftEdit(base, box.text)) return box

    return { ...box, decorations: [...(box.decorations ?? []), ...labelFor(wrap)] }
  } catch {
    return box
  }
}
