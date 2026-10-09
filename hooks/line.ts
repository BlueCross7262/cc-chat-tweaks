type Json = Record<string, unknown>

export type ProgressInput = {
  pointer: unknown
  chain: unknown
  prd: unknown
  ralph: unknown
}

const asRecord = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null

const asList = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Json => item !== null)
    : []

export const chainPathOf = (pointer: unknown): string | null => {
  const path = asRecord(pointer)?.chain_state_path

  return typeof path === 'string' && path !== '' ? path : null
}

const normalizePath = (path: string): string =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

const stampOf = (pointer: Json): number => {
  const updatedAt = asRecord(pointer._meta)?.updatedAt
  const time = typeof updatedAt === 'string' ? Date.parse(updatedAt) : Number.NaN

  return Number.isNaN(time) ? 0 : time
}

export const pickPointer = (candidates: unknown[], projectRoot: string): unknown => {
  const root = normalizePath(projectRoot)
  const qualified = candidates
    .map(asRecord)
    .filter(
      (pointer): pointer is Json =>
        pointer !== null &&
        pointer.active === true &&
        chainPathOf(pointer) !== null &&
        typeof pointer.project_path === 'string' &&
        normalizePath(pointer.project_path) === root,
    )
    .sort((left, right) => stampOf(right) - stampOf(left))

  return qualified[0] ?? null
}

type Part = { label: string; title: string | null }

const titleOf = (item: Json | undefined, key: string): string | null => {
  const title = item?.[key]

  return typeof title === 'string' && title.trim() !== '' ? title.trim() : null
}

const phasePart = (pointer: unknown, chain: unknown): Part | null => {
  const phases = asList(asRecord(chain)?.phases)

  if (phases.length === 0) {
    return null
  }

  const running = phases.findIndex(phase => phase.status === 'running')
  const pointedId = asRecord(pointer)?.phase_id
  const index =
    running >= 0 ? running : phases.findIndex(phase => phase.id === pointedId)

  return index >= 0
    ? { label: `Phase ${index + 1}/${phases.length}`, title: titleOf(phases[index], 'title') }
    : null
}

const storyPart = (prd: unknown, ralph: unknown): Part | null => {
  const state = asRecord(ralph)

  if (state?.active !== true) {
    return null
  }

  const stories = asList(asRecord(prd)?.userStories)

  if (stories.length === 0) {
    return null
  }

  const open = stories.findIndex(story => story.passes !== true)
  const index = open >= 0 ? open : stories.length - 1

  return {
    label: `Story ${index + 1}/${stories.length}`,
    title: titleOf(stories[index], 'titleKo'),
  }
}

export const buildLine = ({
  pointer,
  chain,
  prd,
  ralph,
}: ProgressInput): string | undefined => {
  const phase = phasePart(pointer, chain)
  const story = storyPart(prd, ralph)
  const labels = [phase?.label, story?.label].filter(
    (label): label is string => label !== undefined,
  )

  if (labels.length === 0) {
    return undefined
  }

  const title = story === null ? phase?.title : story.title

  return title ? `${labels.join(' · ')} · ${title}` : labels.join(' · ')
}
