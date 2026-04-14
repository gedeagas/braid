// ---------------------------------------------------------------------------
// Pure token accumulation utilities — no side effects, zero dependencies
// ---------------------------------------------------------------------------

export interface TokenUsage {
  input: number
  output: number
}

export interface RawTokenUsage {
  input_tokens?: number
  output_tokens?: number
}

/**
 * Accumulate token counts from a single turn into the running session total.
 * Pure function: no state reads, no side effects.
 */
export function accumulateTokens(
  prev: TokenUsage | null | undefined,
  usage: RawTokenUsage | undefined
): TokenUsage {
  const base = prev ?? { input: 0, output: 0 }
  if (!usage) return base
  return {
    input: base.input + (usage.input_tokens ?? 0),
    output: base.output + (usage.output_tokens ?? 0)
  }
}
