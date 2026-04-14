// ---------------------------------------------------------------------------
// Shared constants and formatting utilities
// ---------------------------------------------------------------------------

/** Maximum context window size in tokens (Claude model limit) */
export const CONTEXT_WINDOW = 200_000

/** Format token count for display: <1000 raw, >=1000 as "k" notation */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`
}
