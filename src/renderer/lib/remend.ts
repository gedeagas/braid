// ---------------------------------------------------------------------------
// Lightweight streaming markdown repair.
// Closes unclosed formatting tokens so partial markdown renders correctly
// during streaming. Inspired by Streamdown's `remend` package.
// ---------------------------------------------------------------------------

import { hasIncompleteCodeFence } from './incompleteCodeUtils'

/**
 * Check if a position is inside a fenced code block.
 */
function isWithinCodeBlock(text: string): boolean {
  return hasIncompleteCodeFence(text)
}

/**
 * Find the last occurrence of a pattern outside of code spans and fenced blocks.
 * Returns the index or -1.
 */
function lastIndexOutsideCode(text: string, needle: string): number {
  // Walk backwards looking for the needle, skip if inside backtick spans
  let idx = text.lastIndexOf(needle)
  while (idx >= 0) {
    // Count backticks before this position to check if we're in inline code
    const before = text.slice(0, idx)
    const backtickCount = (before.match(/`/g) || []).length
    if (backtickCount % 2 === 0) return idx
    idx = text.lastIndexOf(needle, idx - 1)
  }
  return -1
}

/**
 * Close unclosed inline code (single backtick).
 */
function handleIncompleteInlineCode(text: string): string {
  if (isWithinCodeBlock(text)) return text

  // Count backticks - if odd number at the end, close it
  const lines = text.split('\n')
  const lastLine = lines[lines.length - 1]
  const backtickCount = (lastLine.match(/`/g) || []).length
  if (backtickCount % 2 === 1) {
    return text + '`'
  }
  return text
}

/**
 * Close unclosed bold (**) formatting.
 * Counts all ** occurrences outside code spans - if odd, the last one is unmatched.
 */
function handleIncompleteBold(text: string): string {
  if (isWithinCodeBlock(text)) return text

  // Strip inline code spans, then count non-overlapping ** occurrences
  const withoutCode = text.replace(/`[^`]*`/g, '')
  const matches = withoutCode.match(/\*\*/g)
  if (!matches || matches.length % 2 === 0) return text

  // Odd count means one unclosed ** - check there's content after it
  const lastOpen = lastIndexOutsideCode(text, '**')
  if (lastOpen < 0) return text
  const after = text.slice(lastOpen + 2).trim()
  if (after.length > 0) {
    return text + '**'
  }
  return text
}

/**
 * Close unclosed italic (*) formatting.
 * Must run after bold handler to avoid double-closing.
 */
function handleIncompleteItalic(text: string): string {
  if (isWithinCodeBlock(text)) return text

  // Count unmatched * that aren't part of ** or ***
  // Simple heuristic: check if the last non-whitespace content
  // starts with a single * without a matching close
  const lines = text.split('\n')
  const lastLine = lines[lines.length - 1]

  // Replace ** pairs, then check for lone *
  const stripped = lastLine.replace(/\*\*/g, '')
  const starCount = (stripped.match(/\*/g) || []).length
  if (starCount % 2 === 1) {
    return text + '*'
  }
  return text
}

/**
 * Close unclosed strikethrough (~~) formatting.
 * Counts all ~~ occurrences outside code spans - if odd, the last one is unmatched.
 */
function handleIncompleteStrikethrough(text: string): string {
  if (isWithinCodeBlock(text)) return text

  // Strip inline code spans, then count non-overlapping ~~ occurrences
  const withoutCode = text.replace(/`[^`]*`/g, '')
  const matches = withoutCode.match(/~~/g)
  if (!matches || matches.length % 2 === 0) return text

  // Odd count means one unclosed ~~ - check there's content after it
  const lastOpen = lastIndexOutsideCode(text, '~~')
  if (lastOpen < 0) return text
  const after = text.slice(lastOpen + 2).trim()
  if (after.length > 0) {
    return text + '~~'
  }
  return text
}

/**
 * Handle incomplete links: [text](url
 * If we see an unclosed link at the end, either remove it or close it.
 */
function handleIncompleteLink(text: string): string {
  if (isWithinCodeBlock(text)) return text

  // Match pattern: [text]( at end without closing )
  const match = text.match(/\[([^\]]*)\]\(([^)]*?)$/)
  if (match) {
    // If URL part is empty or partial, just show the text
    if (!match[2] || match[2].length < 3) {
      return text.slice(0, match.index!) + match[1]
    }
    // Close the link
    return text + ')'
  }

  // Match pattern: [text without closing ]
  const bracketMatch = text.match(/\[([^\]]*)$/)
  if (bracketMatch) {
    const content = bracketMatch[1].trim()
    if (content.length > 0 && !content.includes('\n')) {
      return text + ']'
    }
  }

  return text
}

/**
 * Handle incomplete setext headings.
 * When streaming, a line of just `=` or `-` after text looks like a setext
 * heading but might just be the start of a separator or other content.
 */
function handleIncompleteSetextHeading(text: string): string {
  // If text ends with a line of just = or - characters, escape it
  const match = text.match(/\n(={1,}|-{1,})\s*$/)
  if (match) {
    const lines = text.split('\n')
    const lastLine = lines[lines.length - 1].trim()
    const prevLine = lines.length > 1 ? lines[lines.length - 2].trim() : ''

    // Only escape if there's a non-empty line before it (setext heading trigger)
    if (prevLine.length > 0 && /^[=-]+$/.test(lastLine)) {
      lines[lines.length - 1] = '\\' + lines[lines.length - 1]
      return lines.join('\n')
    }
  }
  return text
}

/**
 * Repair incomplete markdown for streaming display.
 *
 * Applies a chain of handlers to close unclosed formatting tokens:
 * - Inline code (backticks)
 * - Bold (**)
 * - Italic (*)
 * - Strikethrough (~~)
 * - Links ([text](url)
 * - Setext headings (=== / ---)
 *
 * Should be called on streaming content BEFORE parsing into blocks.
 */
export function remend(text: string): string {
  if (!text || typeof text !== 'string') return text

  let result = text

  // Remove trailing single space (but keep double space for <br>)
  if (result.endsWith(' ') && !result.endsWith('  ')) {
    result = result.slice(0, -1)
  }

  // Order matters - run in priority order (same as Streamdown)
  result = handleIncompleteSetextHeading(result)
  result = handleIncompleteLink(result)
  result = handleIncompleteBold(result)
  result = handleIncompleteItalic(result)
  result = handleIncompleteInlineCode(result)
  result = handleIncompleteStrikethrough(result)

  return result
}
