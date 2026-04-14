import { describe, it, expect } from 'vitest'
import { accumulateTokens } from '../handlers/tokenUtils'

describe('accumulateTokens', () => {
  // ── baseline / identity ──────────────────────────────────────────────────

  it('returns {0,0} when both args are null/undefined', () => {
    expect(accumulateTokens(null, undefined)).toEqual({ input: 0, output: 0 })
  })

  it('returns base unchanged when usage is undefined', () => {
    expect(accumulateTokens({ input: 10, output: 5 }, undefined)).toEqual({ input: 10, output: 5 })
  })

  it('returns base unchanged when usage is empty object', () => {
    expect(accumulateTokens({ input: 10, output: 5 }, {})).toEqual({ input: 10, output: 5 })
  })

  // ── accumulation ─────────────────────────────────────────────────────────

  it('accumulates input and output tokens from null base', () => {
    expect(accumulateTokens(null, { input_tokens: 10, output_tokens: 5 })).toEqual({ input: 10, output: 5 })
  })

  it('accumulates input and output tokens into existing total', () => {
    expect(accumulateTokens({ input: 100, output: 50 }, { input_tokens: 10, output_tokens: 5 })).toEqual({ input: 110, output: 55 })
  })

  it('accumulates only input_tokens when output_tokens is missing', () => {
    expect(accumulateTokens({ input: 20, output: 10 }, { input_tokens: 5 })).toEqual({ input: 25, output: 10 })
  })

  it('accumulates only output_tokens when input_tokens is missing', () => {
    expect(accumulateTokens({ input: 20, output: 10 }, { output_tokens: 3 })).toEqual({ input: 20, output: 13 })
  })

  // ── edge cases: undefined base ────────────────────────────────────────────

  it('treats undefined base the same as null', () => {
    expect(accumulateTokens(undefined, { input_tokens: 7, output_tokens: 3 })).toEqual({ input: 7, output: 3 })
  })

  // ── no NaN propagation ────────────────────────────────────────────────────

  it('does not produce NaN when token values are undefined', () => {
    const result = accumulateTokens({ input: 5, output: 5 }, { input_tokens: undefined, output_tokens: undefined })
    expect(result.input).toBe(5)
    expect(result.output).toBe(5)
    expect(Number.isNaN(result.input)).toBe(false)
    expect(Number.isNaN(result.output)).toBe(false)
  })

  // ── idempotency / multiple calls ──────────────────────────────────────────

  it('correctly chains multiple accumulations', () => {
    const turn1 = accumulateTokens(null, { input_tokens: 100, output_tokens: 50 })
    const turn2 = accumulateTokens(turn1, { input_tokens: 200, output_tokens: 100 })
    const turn3 = accumulateTokens(turn2, { input_tokens: 50, output_tokens: 25 })
    expect(turn3).toEqual({ input: 350, output: 175 })
  })

  it('does not mutate the previous total', () => {
    const prev = { input: 100, output: 50 }
    accumulateTokens(prev, { input_tokens: 10, output_tokens: 5 })
    expect(prev).toEqual({ input: 100, output: 50 })
  })
})
