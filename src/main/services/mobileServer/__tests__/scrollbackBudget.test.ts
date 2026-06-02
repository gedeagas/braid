import { describe, it, expect } from 'vitest'
import { budgetScrollback } from '../scrollbackBudget'

describe('budgetScrollback', () => {
  it('returns the input unchanged when no budget is given', () => {
    const s = 'a'.repeat(10_000)
    expect(budgetScrollback(s)).toBe(s)
    expect(budgetScrollback(s, 0)).toBe(s)
  })

  it('returns the input unchanged when it already fits the budget', () => {
    const s = 'line one\nline two\n'
    expect(budgetScrollback(s, 1024)).toBe(s)
  })

  it('keeps the tail and starts at a clean line boundary', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n')
    const out = budgetScrollback(lines, 30)
    expect(out.length).toBeLessThanOrEqual(30)
    // Trimmed forward past the first partial line, so it begins mid-stream but
    // on a whole line - never with a fragment of the cut line.
    expect(lines.endsWith(out)).toBe(true)
    expect(out.startsWith('line-')).toBe(true)
  })

  it('falls back to the raw tail when the window holds no newline', () => {
    const s = 'x'.repeat(1000)
    const out = budgetScrollback(s, 100)
    expect(out).toBe('x'.repeat(100))
  })

  it('keeps the tail when its only newline is the final char (no empty result)', () => {
    const s = 'abcdef\n'
    // tail = last 4 chars = 'def\n'; the newline is the last char, so trimming
    // forward would yield '' - we keep the tail intact instead.
    const out = budgetScrollback(s, 4)
    expect(out).toBe('def\n')
  })
})
