import { describe, it, expect } from 'vitest'
import { contrastRatio, ensureContrast, MIN_TEXT_CONTRAST } from '../contrast'
import { deriveTextColors } from '../apply'
import { builtinThemes } from '../palettes'

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#8c959f', '#8c959f')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#656d76', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#656d76'), 5)
  })
})

describe('ensureContrast', () => {
  it('returns the original color when it already passes', () => {
    expect(ensureContrast('#656d76', ['#ffffff'], 4.5, '#1f2328')).toBe('#656d76')
  })

  it('moves a failing color toward the anchor until it passes on every background', () => {
    const result = ensureContrast('#8c959f', ['#ffffff', '#f6f8fa'], 4.5, '#1f2328')
    expect(contrastRatio(result, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(result, '#f6f8fa')).toBeGreaterThanOrEqual(4.5)
  })

  it('stays as close to the original as possible', () => {
    const result = ensureContrast('#8c959f', ['#ffffff'], 4.5, '#1f2328')
    expect(contrastRatio(result, '#ffffff')).toBeLessThan(4.7)
  })

  it('works for dark themes (lightens toward a light anchor)', () => {
    const result = ensureContrast('#484f58', ['#0d1117'], 4.5, '#e6edf3')
    expect(contrastRatio(result, '#0d1117')).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back to the anchor when the target is unreachable', () => {
    expect(ensureContrast('#777777', ['#808080'], 21, '#888888')).toBe('#888888')
  })

  it('returns non-hex input unchanged', () => {
    expect(ensureContrast('rgb(0,0,0)', ['#ffffff'], 4.5, '#000000')).toBe('rgb(0,0,0)')
  })
})

describe('builtin palettes meet text contrast minimums', () => {
  for (const theme of builtinThemes) {
    it(`${theme.id}`, () => {
      const c = theme.colors
      const text = deriveTextColors(c)
      for (const bg of [c.bgPrimary, c.bgSecondary, c.bgTertiary]) {
        expect(contrastRatio(text.secondary, bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        expect(contrastRatio(text.muted, bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        expect(contrastRatio(text.tertiary, bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      }
      // Hierarchy survives the correction: tertiary is never more prominent than muted.
      expect(contrastRatio(text.tertiary, c.bgPrimary)).toBeLessThanOrEqual(contrastRatio(text.muted, c.bgPrimary) + 0.01)
    })
  }
})
