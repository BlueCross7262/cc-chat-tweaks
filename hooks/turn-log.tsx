import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { flagsOf, SETTINGS_SOURCES } from './settings'
import {
  appendLine,
  commonDirOf,
  costSince,
  gitdirOf,
  logPathOf,
  MAX_LOG_BYTES,
  parentOf,
  recordsOf,
  turnLogText,
  turnRecordOf,
  type FinishedTurn,
} from './turn-log-logic'

export const TURN_LOG_COMMAND = 'turn-log'
export const TURN_LOG_HELP = 'Show the turn log of this session: time, tokens and cost per turn, with a total'

const lastCostAtom = atom({ plugin: 'cc-chat-tweaks', key: 'turnLogCost' } as const, null as number | null)

let queue: Promise<void> = Promise.resolve()

async function isTurnLogOn($: EngineInterface): Promise<boolean> {
  try {
    const sources = await Promise.all(SETTINGS_SOURCES.map(source => $.settings.read({ source })))

    return flagsOf(sources)['use-turn-log']
  } catch {
    return false
  }
}

async function gitDirOf($: EngineInterface, start: string): Promise<string | null> {
  for (let dir: string | null = start; dir !== null; dir = parentOf(dir)) {
    const dotGit = `${dir.replace(/[\\/]+$/, '')}/.git`
    const stat = await $.fs.stat(dotGit).catch(() => undefined)

    if (stat?.kind === 'dir') return dotGit

    if (stat?.kind === 'file') {
      const gitdir = gitdirOf(await $.fs.read(dotGit), dir)

      if (gitdir === null) return null

      return commonDirOf(gitdir, await $.fs.read(`${gitdir}/commondir`).catch(() => null))
    }
  }

  return null
}

async function logDirOf($: EngineInterface): Promise<string | null> {
  const gitDir = await gitDirOf($, await $.session.root()).catch(() => null)

  if (gitDir !== null) return gitDir

  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))

  return home ? `${home.replace(/[\\/]+$/, '')}/.claude` : null
}

async function writeRecord($: EngineInterface, turn: FinishedTurn): Promise<void> {
  if (!(await isTurnLogOn($))) return

  const dir = await logDirOf($)

  if (dir === null) return

  const sessionId = await $.session.id()
  const usage = await $.session.usage()
  const total = usage.cost?.usd ?? null
  const last = await read($, lastCostAtom)

  if (total !== null) await update($, lastCostAtom, () => total)

  const record = turnRecordOf({
    at: await $.clock.now(),
    sessionId,
    turn,
    costUsd: costSince(total, last),
    sessionCostUsd: total,
    contextPercent: usage.context.percent ?? null,
  })
  const path = logPathOf(dir, sessionId)
  const existing = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const next = appendLine(existing, record)

  if (next.length > MAX_LOG_BYTES) return

  await $.fs.write(path, next)
}

export async function turnLogReport($: EngineInterface): Promise<string> {
  const dir = await logDirOf($)

  if (dir === null) return 'No turn log: neither a .git folder nor a home folder was found.'

  const path = logPathOf(dir, await $.session.id())

  if (!(await $.fs.exists(path))) {
    return `No turn log for this session at ${path}. Turn it on with ccChatTweaks.chat.turn-log.use and run /reload-plugins.`
  }

  return turnLogText(path, recordsOf(await $.fs.read(path)))
}

export function logTurn($: EngineInterface, turn: FinishedTurn): Promise<void> {
  queue = queue.then(() => writeRecord($, turn)).catch(() => undefined)

  return queue
}
