// ── Claude models ────────────────────────────────────────────────────────────
//
// Single source for the Claude models Braid offers, and the per-model API
// rules the agent worker must respect. Shared by main and renderer.

export const CLAUDE_MODELS = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id']

export const CLAUDE_MODEL_IDS: readonly string[] = CLAUDE_MODELS.map((m) => m.id)

export function isClaudeModelId(value: unknown): value is ClaudeModelId {
  return typeof value === 'string' && CLAUDE_MODEL_IDS.includes(value)
}

// Longest id first so "claude-opus-5-5" never matches the "claude-opus-5" prefix.
const LABEL_PREFIXES = CLAUDE_MODELS
  .map((m) => ({ prefix: m.id.replace(/-\d{8}$/, ''), label: m.label }))
  .sort((a, b) => b.prefix.length - a.prefix.length)

/** Display name for a raw model id from the API (may carry a date suffix). */
export function modelLabel(raw: string): string | null {
  for (const { prefix, label } of LABEL_PREFIXES) {
    if (raw === prefix || raw.startsWith(`${prefix}-`)) return label
  }
  return null
}

function is(model: string, ...prefixes: string[]): boolean {
  return prefixes.some((p) => model === p || model.startsWith(`${p}-`) || model.startsWith(`${p}[`))
}

const HIGH_OR_BELOW = new Set(['low', 'medium', 'high'])

/**
 * Whether thinking may be turned off for this request. Fable 5/5.1 (and the
 * Mythos counterparts), Opus 5.5 and Sonnet 5.5 reject disabled thinking
 * outright; Opus 5 and Haiku 5.5 only accept it at effort `high` or below.
 */
export function canDisableThinking(model: string, effort: string): boolean {
  if (is(model, 'claude-fable', 'claude-mythos', 'claude-opus-5-5', 'claude-sonnet-5-5')) return false
  if (is(model, 'claude-opus-5', 'claude-haiku-5-5')) return HIGH_OR_BELOW.has(effort || 'high')
  return true
}

/** The effort the API uses when none is sent. */
export function apiDefaultEffort(model: string): string {
  return is(model, 'claude-opus-5-5', 'claude-haiku-5-5') ? 'medium' : 'high'
}

/** Effort to send, or undefined when it matches the API default. */
export function effortToSend(model: string, effort: string): string | undefined {
  if (!effort || effort === apiDefaultEffort(model)) return undefined
  return effort
}
