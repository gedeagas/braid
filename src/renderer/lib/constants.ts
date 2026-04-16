// ---------------------------------------------------------------------------
// Shared constants and formatting utilities
// ---------------------------------------------------------------------------

/** Default context window size in tokens (200k) */
export const CONTEXT_WINDOW = 200_000

/** Extended context window size in tokens (1M, Sonnet models only) */
export const EXTENDED_CONTEXT_WINDOW = 1_000_000

/** Returns the effective context window for a given model + extendedContext flag. */
export function getContextWindow(model: string, extendedContext: boolean): number {
  if (extendedContext && supportsExtendedContext(model)) return EXTENDED_CONTEXT_WINDOW
  return CONTEXT_WINDOW
}

/** Returns true if the model supports extended (1M) context. */
export function supportsExtendedContext(model: string): boolean {
  return model.includes('sonnet')
}

/** Format token count for display: <1000 raw, 1M for exactly 1_000_000, else "k" notation */
export function formatTokens(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`
  if (n < 1000) return String(n)
  const k = n / 1000
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`
}
