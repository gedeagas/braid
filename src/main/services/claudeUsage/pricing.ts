// Estimated API cost of Claude usage, from token counts and list prices.
//
// Known gap: usage is aggregated per day and model before pricing, so models
// with a long-prompt tier (Haiku 5.5 above 100K input tokens) are priced at
// the short-prompt rate. Estimates for those runs come out low.

type ModelPricing = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// $/MTok. Cache writes are 1.25x input and cache reads 0.1x input, except
// where Anthropic lists a different read price (Fable 5.1).
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // Prompts up to 100K tokens; longer prompts cost more ($0.50 / $2.50).
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Anthropic intro pricing for Sonnet 5 is effective through August 31, 2026.
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-haiku-3-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
}

function normalizeModelForPricing(model: string | null): string | null {
  if (!model) return null
  const lower = model.toLowerCase().trim().replace(/^anthropic[/:]/, '')

  // Most specific first: "opus-5-5" also contains "opus-5".
  if (lower.includes('fable-5-1')) return 'claude-fable-5-1'
  if (lower.includes('fable-5')) return 'claude-fable-5'
  if (lower.includes('opus-5-5')) return 'claude-opus-5-5'
  if (lower.includes('opus-5')) return 'claude-opus-5'
  if (lower.includes('sonnet-5-5')) return 'claude-sonnet-5-5'
  if (lower.includes('haiku-5-5')) return 'claude-haiku-5-5'
  if (lower.includes('opus-4-8')) return 'claude-opus-4-8'
  if (lower.includes('opus-4-7')) return 'claude-opus-4-7'
  if (lower.includes('opus-4-6')) return 'claude-opus-4-6'
  if (lower.includes('opus-4-5')) return 'claude-opus-4-6'
  if (lower.includes('sonnet-5')) return 'claude-sonnet-5'
  if (lower.includes('sonnet-4-6')) return 'claude-sonnet-4-6'
  if (lower.includes('sonnet-4-5') || lower.includes('sonnet-4')) return 'claude-sonnet-4-5'
  if (lower.includes('sonnet-3-7') || lower.includes('sonnet-3.7')) return 'claude-sonnet-4-5'
  if (lower.includes('sonnet-3-5') || lower.includes('sonnet-3.5') || lower.includes('3-5-sonnet') || lower.includes('3.5-sonnet')) return 'claude-sonnet-4-5'
  if (lower.includes('haiku-4-5')) return 'claude-haiku-4-5'
  if (lower.includes('haiku-3-5') || lower.includes('haiku-3.5') || lower.includes('3-5-haiku') || lower.includes('3.5-haiku')) return 'claude-haiku-3-5'
  return null
}

export function estimateCostUsd(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
): number | null {
  const normalized = normalizeModelForPricing(model)
  if (!normalized) return null
  const p = MODEL_PRICING[normalized]
  if (!p) return null
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheReadTokens * p.cacheRead +
      cacheWriteTokens * p.cacheWrite) /
    1_000_000
  )
}
