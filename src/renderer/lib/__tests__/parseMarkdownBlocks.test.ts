import { describe, it, expect } from 'vitest'
import { parseMarkdownBlocks } from '../parseMarkdownBlocks'

/** Filter out whitespace-only blocks (marked Lexer emits space tokens between blocks) */
function contentBlocks(blocks: string[]): string[] {
  return blocks.filter(b => b.trim())
}

describe('parseMarkdownBlocks', () => {
  // ── basic splitting ────────────────────────────────────────────────────────

  it('returns empty array for empty input', () => {
    expect(parseMarkdownBlocks('')).toEqual([])
  })

  it('splits a heading and a paragraph into separate blocks', () => {
    const md = '# Hello\n\nWorld'
    const blocks = contentBlocks(parseMarkdownBlocks(md))
    expect(blocks.length).toBe(2)
    expect(blocks[0]).toContain('# Hello')
    expect(blocks[1]).toContain('World')
  })

  it('splits multiple paragraphs', () => {
    const md = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.'
    const blocks = contentBlocks(parseMarkdownBlocks(md))
    expect(blocks.length).toBe(3)
  })

  // ── code fences ────────────────────────────────────────────────────────────

  it('keeps a fenced code block as a single block', () => {
    const md = '# Title\n\n```js\nconst x = 1\nconst y = 2\n```\n\nAfter code'
    const blocks = contentBlocks(parseMarkdownBlocks(md))
    expect(blocks.length).toBe(3)
    const codeBlock = blocks.find(b => b.includes('```js'))
    expect(codeBlock).toBeDefined()
    expect(codeBlock).toContain('const x = 1')
    expect(codeBlock).toContain('```')
  })

  it('keeps a tilde code fence as a single block', () => {
    const md = '~~~python\nprint("hello")\n~~~'
    const blocks = parseMarkdownBlocks(md)
    expect(blocks.length).toBe(1)
    expect(blocks[0]).toContain('~~~python')
  })

  // ── lists ──────────────────────────────────────────────────────────────────

  it('treats a list as a single block', () => {
    const md = 'Intro text\n\n- item 1\n- item 2\n- item 3\n\nAfter list'
    const blocks = contentBlocks(parseMarkdownBlocks(md))
    expect(blocks.length).toBe(3)
    const listBlock = blocks.find(b => b.includes('- item 1'))
    expect(listBlock).toBeDefined()
    expect(listBlock).toContain('- item 3')
  })

  // ── GFM tables ─────────────────────────────────────────────────────────────

  it('keeps a GFM table as a single block', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
    const blocks = parseMarkdownBlocks(md)
    expect(blocks.length).toBe(1)
    expect(blocks[0]).toContain('| A | B |')
  })

  // ── HTML blocks ────────────────────────────────────────────────────────────

  it('merges HTML blocks with unclosed tags', () => {
    const md = '<div>\n\nSome content\n\n</div>\n\nAfter div'
    const blocks = parseMarkdownBlocks(md)
    // The div block should be merged into one
    const divBlock = blocks.find(b => b.includes('<div>'))
    expect(divBlock).toBeDefined()
    expect(divBlock).toContain('</div>')
  })

  // ── footnotes ──────────────────────────────────────────────────────────────

  it('returns entire document as one block when footnotes are present', () => {
    const md = 'Text with a reference[^1].\n\n[^1]: This is the footnote.'
    const blocks = parseMarkdownBlocks(md)
    expect(blocks.length).toBe(1)
    expect(blocks[0]).toBe(md)
  })

  // ── blockquotes ────────────────────────────────────────────────────────────

  it('keeps a blockquote as a single block', () => {
    const md = 'Before\n\n> This is a quote\n> spanning multiple lines\n\nAfter'
    const blocks = contentBlocks(parseMarkdownBlocks(md))
    expect(blocks.length).toBe(3)
    expect(blocks.some(b => b.includes('> This is a quote'))).toBe(true)
  })

  // ── horizontal rule ────────────────────────────────────────────────────────

  it('treats a horizontal rule as its own block', () => {
    const md = 'Before\n\n---\n\nAfter'
    const blocks = contentBlocks(parseMarkdownBlocks(md))
    expect(blocks.length).toBe(3)
  })

  // ── raw content preservation ───────────────────────────────────────────────

  it('concatenated blocks reproduce the original markdown', () => {
    const md = '# Hello\n\nParagraph 1.\n\n```js\ncode\n```\n\nParagraph 2.'
    const blocks = parseMarkdownBlocks(md)
    expect(blocks.join('')).toBe(md)
  })
})
