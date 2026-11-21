import type { EngineInterface } from 'claude-code'

import { flagsOf, SETTINGS_SOURCES, type Flags } from './settings'
import { normalizeCompletion, sourceOf } from './upgrade-logic'

export const RENAME_COMMAND = 'rename'
export const NAME_MAX = 30
const PROMPT_MAX = 2000
const ANSWER_MAX = 6000
const SUMMARY_SYSTEM =
  'You name a coding chat session from the user prompt and the assistant answer you are given. Reply with only one short noun phrase of at most six words and at most 30 characters, written in Korean. It is a title, not a sentence: never explain, never describe the request, never address the user. Keep code identifiers, file names and commands as they are. Do not end the title with the word 세션 or session. End the title with a verb in the -하기 form, for example 밴드 턴 시간 수정하기. Do not put a label such as 세션 제목: or Title: before the title. No quotes and no period at the end.'

let lastPrompt = ''
let promptSeq = 0
let renamedSeq = -1
let isPending = false

const LABEL = /^(?:[^\s:：]+\s+){0,2}(?:세션\s*)?(?:제목|이름|title|session\s*(?:name|title)|name)(?:\s+[^\s:：]+){0,2}\s*[:：]\s*/i

const firstSentence = (line: string): string => line.split(/[.!?。](?:\s|$)/)[0] ?? ''

const fitName = (name: string): string => {
  if (name.length <= NAME_MAX) return name

  const cut = name.slice(0, NAME_MAX + 1).lastIndexOf(' ')

  return (cut > 0 ? name.slice(0, cut) : name.slice(0, NAME_MAX)).trim()
}

export const nameOf = (text: string | null): string =>
  fitName(
    firstSentence(
      (text ?? '')
        .split(/\r?\n/)
        .map(line => line.trim().replace(/^["'`]+|["'`]+$/g, '').trim().replace(LABEL, '').replace(/^["'`]+/, '').trim())
        .find(line => line !== '') ?? '',
    )
      .replace(/["'`]+$/g, '')
      .trim(),
  )

export function noteTurnStart(e: { text: string; agentId?: string }): void {
  if (e.agentId !== undefined || e.text.trim() === '') return

  lastPrompt = sourceOf(e.text) ?? e.text
  promptSeq += 1
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
      prompt: `<user_prompt>\n${lastPrompt.slice(0, PROMPT_MAX)}\n</user_prompt>\n\n<assistant_answer>\n${answer.slice(0, ANSWER_MAX)}\n</assistant_answer>`,
      maxTokens: 60,
      timeoutMs: 5000,
    })

    return nameOf(normalizeCompletion(reply))
  } catch {
    return ''
  }
}

export async function renameSession($: EngineInterface, e: { answer: string; agentId?: string }): Promise<void> {
  if (e.agentId !== undefined || isPending || renamedSeq === promptSeq) return

  const flags = await flagsOrNull($)

  if (flags === null || !flags['use-session-rename'] || isPending || renamedSeq === promptSeq) return

  const seq = promptSeq
  const previous = renamedSeq
  isPending = true
  renamedSeq = seq

  const run = async (): Promise<void> => {
    try {
      const args = flags['use-session-rename-haiku-generated-name'] ? await summaryOf($, e.answer) : ''

      await $.command.run({ command: RENAME_COMMAND, args })
    } catch (error) {
      if (renamedSeq === seq) renamedSeq = previous
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
    renamedSeq = previous
    isPending = false
  }
}
