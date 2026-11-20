import type { EngineInterface } from 'claude-code'

import { flagsOf, SETTINGS_SOURCES, type Flags } from './settings'
import { normalizeCompletion } from './upgrade-logic'

export const RENAME_COMMAND = 'rename'
export const NAME_MAX = 60
const PROMPT_MAX = 2000
const ANSWER_MAX = 6000
const SUMMARY_SYSTEM =
  'You name a coding chat session. Reply with only a short title of at most six words, written in Korean. Keep code identifiers, file names and commands as they are. Do not end the title with the word 세션 or session. End the title with a verb in the -하기 form, for example 밴드 턴 시간 수정하기. No quotes and no period at the end.'

let lastPrompt = ''
let isPending = false

export const nameOf = (text: string | null): string =>
  (text ?? '')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^["'`]+|["'`.]+$/g, '').trim())
    .find(line => line !== '')
    ?.slice(0, NAME_MAX) ?? ''

export function noteTurnStart(e: { text: string; agentId?: string }): void {
  if (e.agentId === undefined) lastPrompt = e.text
}

function writeLog($: EngineInterface, row: string): void {
  try {
    $.ui.log(row)
  } catch {
    return
  }
}

async function flagsOrNull($: EngineInterface): Promise<Flags | null> {
  try {
    return flagsOf(await Promise.all(SETTINGS_SOURCES.map(source => $.settings.read({ source }))))
  } catch {
    return null
  }
}

async function summaryOf($: EngineInterface, answer: string): Promise<string> {
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      system: SUMMARY_SYSTEM,
      prompt: `User:\n${lastPrompt.slice(0, PROMPT_MAX)}\n\nAssistant:\n${answer.slice(0, ANSWER_MAX)}`,
      maxTokens: 200,
      timeoutMs: 5000,
    })

    return nameOf(normalizeCompletion(reply))
  } catch {
    return ''
  }
}

export async function renameSession($: EngineInterface, e: { answer: string; agentId?: string }): Promise<void> {
  if (e.agentId !== undefined || isPending) return

  const flags = await flagsOrNull($)

  if (flags === null || !flags['use-session-rename'] || isPending) return

  isPending = true

  const run = async (): Promise<void> => {
    try {
      const args = flags['use-session-rename-haiku-generated-name'] ? await summaryOf($, e.answer) : ''

      await $.command.run({ command: RENAME_COMMAND, args })
    } catch (error) {
      writeLog($, `[session-rename] renameSession.run error=${error instanceof Error ? error.message : String(error)}`)
    } finally {
      isPending = false
    }
  }

  try {
    $.clock.after(0, () => {
      void run()
    })
  } catch {
    isPending = false
  }
}
