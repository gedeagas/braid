import { describe, it, expect } from 'vitest'
import { hasIncompleteCodeFence, hasTable } from '../incompleteCodeUtils'

describe('hasIncompleteCodeFence', () => {
  // ── no fence ───────────────────────────────────────────────────────────────

  it('returns false for plain text', () => {
    expect(hasIncompleteCodeFence('hello world')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasIncompleteCodeFence('')).toBe(false)
  })

  // ── complete fences ────────────────────────────────────────────────────────

  it('returns false for a complete backtick code fence', () => {
    expect(hasIncompleteCodeFence('```js\nconst x = 1\n```')).toBe(false)
  })

  it('returns false for a complete tilde code fence', () => {
    expect(hasIncompleteCodeFence('~~~\ncode\n~~~')).toBe(false)
  })

  it('returns false for multiple complete fences', () => {
    const md = '```\nblock 1\n```\n\n```\nblock 2\n```'
    expect(hasIncompleteCodeFence(md)).toBe(false)
  })

  // ── incomplete fences ──────────────────────────────────────────────────────

  it('returns true for an unclosed backtick fence', () => {
    expect(hasIncompleteCodeFence('```js\nconst x = 1')).toBe(true)
  })

  it('returns true for an unclosed tilde fence', () => {
    expect(hasIncompleteCodeFence('~~~python\nprint("hi")')).toBe(true)
  })

  it('returns true when closing fence is too short', () => {
    expect(hasIncompleteCodeFence('````\ncode\n```')).toBe(true)
  })

  it('returns false when closing fence is at least as long', () => {
    expect(hasIncompleteCodeFence('```\ncode\n````')).toBe(false)
  })

  // ── indented fences ────────────────────────────────────────────────────────

  it('detects indented opening fence (up to 3 spaces)', () => {
    expect(hasIncompleteCodeFence('   ```\ncode')).toBe(true)
  })

  it('does not treat 4-space indent as fence', () => {
    expect(hasIncompleteCodeFence('    ```\ncode')).toBe(false)
  })

  // ── mixed characters ───────────────────────────────────────────────────────

  it('tilde fence is not closed by backtick fence', () => {
    expect(hasIncompleteCodeFence('~~~\ncode\n```')).toBe(true)
  })

  it('backtick fence is not closed by tilde fence', () => {
    expect(hasIncompleteCodeFence('```\ncode\n~~~')).toBe(true)
  })
})

describe('hasTable', () => {
  it('returns false for plain text', () => {
    expect(hasTable('hello world')).toBe(false)
  })

  it('returns true for a simple GFM table', () => {
    expect(hasTable('| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe(true)
  })

  it('returns true for table with alignment markers', () => {
    expect(hasTable('| A | B | C |\n| :--- | :---: | ---: |')).toBe(true)
  })

  it('returns false for pipe in regular text', () => {
    expect(hasTable('a | b')).toBe(false)
  })

  it('returns true for table without outer pipes', () => {
    expect(hasTable('A | B\n--- | ---\n1 | 2')).toBe(true)
  })
})
