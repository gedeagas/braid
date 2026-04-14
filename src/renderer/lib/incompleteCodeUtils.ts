// ---------------------------------------------------------------------------
// Detect incomplete (unclosed) code fences and GFM tables in markdown.
// Ported from Streamdown's `incomplete-code-utils.ts`.
// ---------------------------------------------------------------------------

/**
 * Regex matching a code fence at the start of a line per CommonMark spec.
 * Allows up to 3 spaces of indentation, then 3+ backticks or 3+ tildes.
 */
const CODE_FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/

/**
 * Regex matching a GFM table delimiter row.
 * Matches rows like `| --- | --- |`, `|---|---|`, `| :---: | ---: |`, etc.
 */
const TABLE_DELIMITER_PATTERN =
  /^\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?$/

/**
 * Check if a markdown string contains an incomplete (unclosed) code fence
 * by walking line-by-line per the CommonMark spec.
 *
 * A closing fence must use the same character as the opening fence and be
 * at least as long. Only counts fences that start at the beginning of a
 * line (with up to 3 spaces of indentation).
 */
export function hasIncompleteCodeFence(markdown: string): boolean {
  const lines = markdown.split('\n')
  let openChar: string | null = null
  let openLen = 0

  for (const line of lines) {
    const match = CODE_FENCE_PATTERN.exec(line)

    if (openChar === null) {
      if (match) {
        const run = match[1]
        openChar = run[0]
        openLen = run.length
      }
    } else if (match) {
      const run = match[1]
      if (run[0] === openChar && run.length >= openLen) {
        openChar = null
        openLen = 0
      }
    }
  }

  return openChar !== null
}

/**
 * Check if a markdown block contains a GFM table by looking for a
 * delimiter row (e.g., `| --- | --- |`).
 */
export function hasTable(markdown: string): boolean {
  const lines = markdown.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length > 0 && trimmed.includes('|') && TABLE_DELIMITER_PATTERN.test(trimmed)) {
      return true
    }
  }

  return false
}
