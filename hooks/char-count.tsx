import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { countChars, countLabel } from './char-count-logic'
import { flagsOf, SETTINGS_SOURCES } from './settings'

const countAtom = atom({ plugin: 'cc-chat-tweaks', key: 'charCount' } as const, 0)

const store = async ($: EngineInterface, text: string): Promise<void> => {
  const count = countChars(text)

  await update($, countAtom, () => count)
}

export async function recount($: EngineInterface): Promise<void> {
  try {
    const count = countChars((await $.prompt.read()).text)

    await update($, countAtom, () => count)
  } catch {
    return
  }
}

const isOn = async ($: EngineInterface): Promise<boolean> =>
  flagsOf(await Promise.all(SETTINGS_SOURCES.map(source => $.settings.read({ source }))))['use-char-count']

export const registerCharCount = (on: Parameters<Register>[0]): void => {
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)

    try {
      await store($, box.text)
    } catch {
      return box
    }

    return box
  })

  on('prompt.fill', async ($, e, next) => {
    const filled = await next(e)

    if (filled.isFilled) await recount($)

    return filled
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    let count = 0

    try {
      count = (await isOn($)) ? await read($, countAtom) : 0
    } catch {
      count = 0
    }

    return count === 0 ? next(e) : next({ ...e, props: { ...e.props, modes: [...e.props.modes, countLabel(count)] } })
  })
}
