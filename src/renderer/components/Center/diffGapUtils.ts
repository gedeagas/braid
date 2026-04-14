/**
 * Utilities for computing and expanding hidden line gaps between diff hunks.
 * Used by DiffReviewView to show "N hidden lines" expanders.
 */
import type { DiffHunk, DiffLine } from '@/lib/diffUtils'

export interface HunkRange {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

export interface GapInfo {
  /** Position index: 0 = before first hunk, 1 = between hunk 0-1, etc. */
  index: number
  /** First hidden line number (in the new file) */
  startNewNo: number
  /** First hidden line number (in the old file) */
  startOldNo: number
  /** Number of hidden lines */
  count: number
}

/** Parse the old/new start+count from a unified diff hunk header. */
export function parseHunkRange(header: string): HunkRange | null {
  const m = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  if (!m) return null
  return {
    oldStart: parseInt(m[1]),
    oldCount: m[2] !== undefined ? parseInt(m[2]) : 1,
    newStart: parseInt(m[3]),
    newCount: m[4] !== undefined ? parseInt(m[4]) : 1,
  }
}

/**
 * Compute the gaps (hidden line ranges) between hunks.
 * Returns one entry per gap where count > 0.
 * @param totalNewLines - total lines in the new file (0 to skip trailing gap)
 */
export function computeGaps(hunks: DiffHunk[], totalNewLines: number): GapInfo[] {
  if (hunks.length === 0) return []

  const ranges = hunks.map((h) => parseHunkRange(h.header)).filter(Boolean) as HunkRange[]
  if (ranges.length !== hunks.length) return []

  const gaps: GapInfo[] = []

  // Leading gap: lines before the first hunk
  const first = ranges[0]
  if (first.newStart > 1) {
    gaps.push({
      index: 0,
      startNewNo: 1,
      startOldNo: 1,
      count: first.newStart - 1,
    })
  }

  // Inter-hunk gaps
  for (let i = 0; i < ranges.length - 1; i++) {
    const prev = ranges[i]
    const next = ranges[i + 1]
    const prevEndNew = prev.newStart + prev.newCount
    const prevEndOld = prev.oldStart + prev.oldCount
    const gapCount = next.newStart - prevEndNew
    if (gapCount > 0) {
      gaps.push({
        index: i + 1,
        startNewNo: prevEndNew,
        startOldNo: prevEndOld,
        count: gapCount,
      })
    }
  }

  // Trailing gap: lines after the last hunk
  if (totalNewLines > 0) {
    const last = ranges[ranges.length - 1]
    const lastEndNew = last.newStart + last.newCount
    const lastEndOld = last.oldStart + last.oldCount
    const trailingCount = totalNewLines - lastEndNew + 1
    if (trailingCount > 0) {
      gaps.push({
        index: ranges.length,
        startNewNo: lastEndNew,
        startOldNo: lastEndOld,
        count: trailingCount,
      })
    }
  }

  return gaps
}

/**
 * Build DiffLine objects for a gap range from the full file content.
 * Lines are typed as 'ctx' since they are unmodified.
 */
export function buildGapLines(
  fileLines: string[],
  startNewNo: number,
  startOldNo: number,
  count: number,
): DiffLine[] {
  const result: DiffLine[] = []
  for (let i = 0; i < count; i++) {
    const lineIdx = startNewNo + i - 1 // 0-based index into fileLines
    result.push({
      type: 'ctx',
      content: fileLines[lineIdx] ?? '',
      oldNo: startOldNo + i,
      newNo: startNewNo + i,
    })
  }
  return result
}
