import { describe, it, expect } from 'vitest'
import { remend } from '../remend'

describe('remend', () => {
  // ── passthrough ────────────────────────────────────────────────────────────

  it('returns empty string as-is', () => {
    expect(remend('')).toBe('')
  })

  it('returns complete markdown unchanged', () => {
    const md = '**bold** and *italic* and `code`'
    expect(remend(md)).toBe(md)
  })

  it('returns null/undefined inputs as-is', () => {
    expect(remend(null as unknown as string)).toBe(null)
    expect(remend(undefined as unknown as string)).toBe(undefined)
  })

  // ── inline code ────────────────────────────────────────────────────────────

  it('closes an unclosed inline code backtick', () => {
    expect(remend('some `code here')).toBe('some `code here`')
  })

  it('does not add backtick when already paired', () => {
    expect(remend('some `code` here')).toBe('some `code` here')
  })

  // ── bold ───────────────────────────────────────────────────────────────────

  it('closes unclosed bold formatting', () => {
    expect(remend('**bold text')).toBe('**bold text**')
  })

  it('does not double-close already paired bold', () => {
    expect(remend('**bold** text')).toBe('**bold** text')
  })

  // ── italic ─────────────────────────────────────────────────────────────────

  it('closes unclosed italic formatting', () => {
    expect(remend('*italic text')).toBe('*italic text*')
  })

  it('does not break already paired italic', () => {
    expect(remend('*italic* text')).toBe('*italic* text')
  })

  // ── strikethrough ──────────────────────────────────────────────────────────

  it('closes unclosed strikethrough', () => {
    expect(remend('~~deleted text')).toBe('~~deleted text~~')
  })

  it('does not double-close paired strikethrough', () => {
    expect(remend('~~deleted~~ text')).toBe('~~deleted~~ text')
  })

  // ── links ──────────────────────────────────────────────────────────────────

  it('closes incomplete link with URL', () => {
    expect(remend('[click here](https://example.com')).toBe('[click here](https://example.com)')
  })

  it('removes link syntax when URL is empty', () => {
    expect(remend('[click here](')).toBe('click here')
  })

  it('closes an unclosed bracket', () => {
    expect(remend('[partial text')).toBe('[partial text]')
  })

  // ── setext headings ────────────────────────────────────────────────────────

  it('escapes trailing setext heading indicator', () => {
    const result = remend('Some heading\n===')
    expect(result).toContain('\\')
    expect(result).not.toMatch(/^Some heading\n===$/)
  })

  it('escapes dash-style setext indicator', () => {
    const result = remend('Some heading\n---')
    expect(result).toContain('\\')
  })

  // ── code blocks skipped ────────────────────────────────────────────────────

  it('does not modify content inside a code fence', () => {
    const md = '```\n**unclosed bold inside fence'
    // Inside a code fence - should not add **
    expect(remend(md)).toBe(md)
  })

  // ── trailing space removal ─────────────────────────────────────────────────

  it('removes trailing single space', () => {
    expect(remend('hello ')).toBe('hello')
  })

  it('preserves trailing double space (line break)', () => {
    expect(remend('hello  ')).toBe('hello  ')
  })
})
