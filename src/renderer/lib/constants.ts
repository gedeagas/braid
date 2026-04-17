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
  return model.includes('sonnet') || model.includes('opus') || model.includes('mythos')
}

/**
 * Returns true if the model requires the beta header for 1M context.
 * Opus 4.6, Sonnet 4.6, and Mythos have native 1M - no beta needed.
 * Older Sonnet models (4, 4.5) require the context-1m beta header.
 */
export function needsExtendedContextBeta(model: string): boolean {
  if (model.includes('opus') || model.includes('mythos')) return false
  if (model.includes('sonnet') && model.includes('4-6')) return false
  return model.includes('sonnet')
}

// ---------------------------------------------------------------------------
// Effort levels
// ---------------------------------------------------------------------------

import type { EffortLevel } from '@/types'

/** Default effort level (matches API default). */
export const DEFAULT_EFFORT: EffortLevel = 'high'

/** Ordered effort levels with short display labels. */
export const EFFORT_LEVELS: readonly { id: EffortLevel; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Med' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
  { id: 'max', label: 'Max' },
]

/** Returns the effort levels supported by a given model. */
export function getEffortLevelsForModel(model: string): EffortLevel[] {
  if (model.includes('opus') && model.includes('4-7')) return ['low', 'medium', 'high', 'xhigh', 'max']
  if (model.includes('opus') || model.includes('sonnet')) return ['low', 'medium', 'high', 'max']
  return [] // Haiku and others: effort not supported
}

/** Returns true if the model supports the effort parameter. */
export function supportsEffort(model: string): boolean {
  return getEffortLevelsForModel(model).length > 0
}

/** Format token count for display: <1000 raw, 1M for exactly 1_000_000, else "k" notation */
export function formatTokens(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`
  if (n < 1000) return String(n)
  const k = n / 1000
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`
}
