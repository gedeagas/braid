// ─── Diff types & parsing ──────────────────────────────────

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  content: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export function parseDiff(raw: string): DiffHunk[] {
  const lines = raw.split('\n')
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldNo = match ? parseInt(match[1]) : 0
      newNo = match ? parseInt(match[2]) : 0
      current = { header: line, lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.lines.push({ type: 'add', content: line.slice(1), oldNo: null, newNo: newNo++ })
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.lines.push({ type: 'del', content: line.slice(1), oldNo: oldNo++, newNo: null })
    } else if (line.startsWith(' ')) {
      current.lines.push({ type: 'ctx', content: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return hunks
}

// ─── Path helpers ──────────────────────────────────────────

export function basename(file: string) {
  return file.split('/').pop() ?? file
}

export function dirname(file: string) {
  const parts = file.split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}
