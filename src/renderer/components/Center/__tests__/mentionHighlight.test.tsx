import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { parseMentions } from '../mentionHighlight'

// Stub window.api.shell.openExternal for link click tests
beforeEach(() => {
  ;(window as any).api = { shell: { openExternal: vi.fn() } }
})

function extractParts(nodes: React.ReactNode[]): Array<{ type: string; text: string; href?: string }> {
  return nodes.map((n) => {
    if (typeof n === 'string') return { type: 'text', text: n }
    if (React.isValidElement(n)) {
      const el = n as React.ReactElement<any>
      if (el.type === 'a') {
        return { type: 'link', text: String(el.props.children), href: el.props.href }
      }
      return { type: 'mention', text: String(el.props.children) }
    }
    return { type: 'unknown', text: String(n) }
  })
}

describe('parseMentions', () => {
  it('returns empty array for empty string', () => {
    expect(parseMentions('', 'cls')).toEqual([])
  })

  it('returns plain text with no matches', () => {
    const parts = parseMentions('hello world', 'cls')
    expect(parts).toEqual(['hello world'])
  })

  it('highlights @mentions', () => {
    const parts = extractParts(parseMentions('hi @alice bye', 'cls'))
    expect(parts).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'mention', text: '@alice' },
      { type: 'text', text: ' bye' },
    ])
  })

  it('renders URLs as clickable links', () => {
    const parts = extractParts(parseMentions('check https://example.com please', 'cls'))
    expect(parts).toEqual([
      { type: 'text', text: 'check ' },
      { type: 'link', text: 'https://example.com', href: 'https://example.com' },
      { type: 'text', text: ' please' },
    ])
  })

  it('handles http URLs', () => {
    const parts = extractParts(parseMentions('go to http://localhost:3000/api', 'cls'))
    expect(parts[1]).toEqual({
      type: 'link',
      text: 'http://localhost:3000/api',
      href: 'http://localhost:3000/api',
    })
  })

  it('handles mixed mentions and URLs', () => {
    const parts = extractParts(parseMentions('@bob see https://github.com/pr/1', 'cls'))
    expect(parts).toEqual([
      { type: 'mention', text: '@bob' },
      { type: 'text', text: ' see ' },
      { type: 'link', text: 'https://github.com/pr/1', href: 'https://github.com/pr/1' },
    ])
  })

  it('does not include trailing parenthesis in URL', () => {
    const parts = extractParts(parseMentions('(https://example.com/path)', 'cls'))
    expect(parts[1]).toEqual({
      type: 'link',
      text: 'https://example.com/path',
      href: 'https://example.com/path',
    })
    // Trailing ) should be plain text
    expect(parts[2]).toEqual({ type: 'text', text: ')' })
  })

  it('handles URL at end of text', () => {
    const parts = extractParts(parseMentions('visit https://example.com', 'cls'))
    expect(parts).toEqual([
      { type: 'text', text: 'visit ' },
      { type: 'link', text: 'https://example.com', href: 'https://example.com' },
    ])
  })

  it('handles URL at start of text', () => {
    const parts = extractParts(parseMentions('https://example.com is great', 'cls'))
    expect(parts).toEqual([
      { type: 'link', text: 'https://example.com', href: 'https://example.com' },
      { type: 'text', text: ' is great' },
    ])
  })

  it('handles URLs with query strings and anchors', () => {
    const parts = extractParts(
      parseMentions('see https://example.com/page?q=1&b=2#section done', 'cls')
    )
    expect(parts).toEqual([
      { type: 'text', text: 'see ' },
      {
        type: 'link',
        text: 'https://example.com/page?q=1&b=2#section',
        href: 'https://example.com/page?q=1&b=2#section',
      },
      { type: 'text', text: ' done' },
    ])
  })

  it('treats @https://... as a mention, not a URL', () => {
    const parts = extractParts(parseMentions('@https://example.com rest', 'cls'))
    // The @-prefix causes the mention branch to win
    expect(parts[0]).toEqual({ type: 'mention', text: '@https://example.com' })
  })

  it('strips trailing punctuation from URLs', () => {
    const parts = extractParts(parseMentions('Check https://google.com.', 'cls'))
    expect(parts).toEqual([
      { type: 'text', text: 'Check ' },
      { type: 'link', text: 'https://google.com', href: 'https://google.com' },
      { type: 'text', text: '.' },
    ])
  })

  it('strips trailing comma from URLs', () => {
    const parts = extractParts(parseMentions('see https://example.com, thanks', 'cls'))
    expect(parts[1]).toEqual({
      type: 'link',
      text: 'https://example.com',
      href: 'https://example.com',
    })
    expect(parts[2]).toEqual({ type: 'text', text: ', thanks' })
  })

  it('does not linkify URLs in backdrop mode (mark tag)', () => {
    const parts = extractParts(parseMentions('see https://example.com ok', 'cls', 'mark'))
    // URL should be plain text, not a link
    expect(parts).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'https://example.com' },
      { type: 'text', text: ' ok' },
    ])
  })
})
