export type Hunk = {
  lines: string[]
  oldStart?: number
  oldLines?: number
  newStart?: number
  newLines?: number
}

export type Patch = Hunk[]

export type EditOutput = {
  type?: 'create' | 'update'
  content?: string
  structuredPatch?: Patch
}

export type LineCounts = { added: number; removed: number }

const EDIT_TOOLS = ['Edit', 'Write']

export const isEditTool = (tool: string): boolean => EDIT_TOOLS.includes(tool)

export const countPatch = (patch: Patch): LineCounts => {
  let added = 0
  let removed = 0

  for (const hunk of patch) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }

  return { added, removed }
}

const linesOf = (text: string): string[] =>
  text === '' ? [] : text.replace(/\n$/, '').split('\n')

const countLines = (text: string): number => linesOf(text).length

export const countOutput = (output: EditOutput): LineCounts => {
  const counts = countPatch(output.structuredPatch ?? [])
  const isNewFile = output.type === 'create' && counts.added === 0

  return isNewFile ? { added: countLines(output.content ?? ''), removed: 0 } : counts
}

const hunkHeader = (hunk: Hunk): string => {
  const oldLines = hunk.oldLines ?? hunk.lines.filter(line => !line.startsWith('+')).length
  const newLines = hunk.newLines ?? hunk.lines.filter(line => !line.startsWith('-')).length

  return `@@ -${hunk.oldStart ?? 1},${oldLines} +${hunk.newStart ?? 1},${newLines} @@`
}

export const toUnifiedDiff = (output: EditOutput): string => {
  const patch = output.structuredPatch ?? []

  if (patch.length > 0) {
    return patch.map(hunk => `${hunkHeader(hunk)}\n${hunk.lines.join('\n')}`).join('\n')
  }

  const created = output.type === 'create' ? linesOf(output.content ?? '') : []

  return created.length === 0
    ? ''
    : `@@ -0,0 +1,${created.length} @@\n${created.map(line => `+${line}`).join('\n')}`
}

export const verbOf = (tool: string, output?: EditOutput): string =>
  tool === 'Write' && output?.type === 'create' ? 'Write' : 'Update'

export const displayPath = (filePath: string, cwd: string): string => {
  const normalize = (path: string): string => path.replace(/\\/g, '/')
  const file = normalize(filePath)
  const base = normalize(cwd).replace(/\/+$/, '') + '/'
  const isInside = file.toLowerCase().startsWith(base.toLowerCase())
  const relative = isInside ? file.slice(base.length) : file

  return cwd.includes('\\') ? relative.replace(/\//g, '\\') : relative
}
