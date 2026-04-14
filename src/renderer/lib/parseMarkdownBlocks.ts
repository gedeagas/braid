// ---------------------------------------------------------------------------
// Parse markdown into top-level blocks for memoized rendering.
// Uses `marked`'s Lexer (same technique as Streamdown) which handles
// code fences, HTML blocks, tables, and other CommonMark constructs correctly.
// ---------------------------------------------------------------------------

import { Lexer } from 'marked'

const footnoteReferencePattern = /\[\^[\w-]{1,200}\](?!:)/
const footnoteDefinitionPattern = /\[\^[\w-]{1,200}\]:/
const openingTagPattern = /<(\w+)[\s>]/

// HTML void elements that don't need closing tags
const voidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// Tag pattern caches to avoid recreating RegExp per call
const openTagCache = new Map<string, RegExp>()
const closeTagCache = new Map<string, RegExp>()

function getOpenTagPattern(tag: string): RegExp {
  const key = tag.toLowerCase()
  let p = openTagCache.get(key)
  if (!p) {
    p = new RegExp(`<${key}(?=[\\s>/])[^>]*>`, 'gi')
    openTagCache.set(key, p)
  }
  p.lastIndex = 0
  return p
}

function getCloseTagPattern(tag: string): RegExp {
  const key = tag.toLowerCase()
  let p = closeTagCache.get(key)
  if (!p) {
    p = new RegExp(`</${key}(?=[\\s>])[^>]*>`, 'gi')
    closeTagCache.set(key, p)
  }
  p.lastIndex = 0
  return p
}

function countNonSelfClosingOpenTags(block: string, tag: string): number {
  if (voidElements.has(tag.toLowerCase())) return 0
  const matches = block.match(getOpenTagPattern(tag))
  if (!matches) return 0
  let count = 0
  for (const m of matches) {
    if (!m.trimEnd().endsWith('/>')) count++
  }
  return count
}

function countClosingTags(block: string, tag: string): number {
  const matches = block.match(getCloseTagPattern(tag))
  return matches ? matches.length : 0
}

/**
 * Split a markdown string into top-level blocks using `marked`'s Lexer.
 *
 * Returns an array of raw markdown strings, one per top-level block.
 * Code fences, HTML blocks, tables etc. are kept as single blocks.
 *
 * Ported from Streamdown's `parse-blocks.tsx`.
 */
export function parseMarkdownBlocks(markdown: string): string[] {
  if (!markdown) return []

  // Footnotes need to stay in one tree for reference resolution
  if (footnoteReferencePattern.test(markdown) || footnoteDefinitionPattern.test(markdown)) {
    return [markdown]
  }

  const tokens = Lexer.lex(markdown, { gfm: true })

  const mergedBlocks: string[] = []
  const htmlStack: string[] = []

  for (const token of tokens) {
    const raw = token.raw

    // Inside an unclosed HTML block - merge with previous
    if (htmlStack.length > 0) {
      mergedBlocks[mergedBlocks.length - 1] += raw

      const trackedTag = htmlStack[htmlStack.length - 1]
      const opens = countNonSelfClosingOpenTags(raw, trackedTag)
      const closes = countClosingTags(raw, trackedTag)

      for (let i = 0; i < opens; i++) htmlStack.push(trackedTag)
      for (let i = 0; i < closes; i++) {
        if (htmlStack.length > 0 && htmlStack[htmlStack.length - 1] === trackedTag) {
          htmlStack.pop()
        }
      }
      continue
    }

    // Check for opening HTML block tag
    if (token.type === 'html' && (token as { block?: boolean }).block) {
      const match = raw.match(openingTagPattern)
      if (match) {
        const tagName = match[1]
        const opens = countNonSelfClosingOpenTags(raw, tagName)
        const closes = countClosingTags(raw, tagName)
        if (opens > closes) {
          htmlStack.push(tagName)
        }
      }
    }

    mergedBlocks.push(raw)
  }

  return mergedBlocks
}
