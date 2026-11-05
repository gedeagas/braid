// Agent types and status states shared by the renderer and the PTY daemon,
// which both run agent status detection.

// ── Agent types ──────────────────────────────────────────────────────────────

export const KNOWN_AGENT_TYPES = [
  'claude', 'codex', 'gemini', 'antigravity', 'opencode', 'cursor', 'copilot',
  'aider', 'pi', 'droid', 'grok', 'hermes', 'unknown'
] as const

export type AgentType = (typeof KNOWN_AGENT_TYPES)[number]

export function isKnownAgentType(value: string | null | undefined): value is AgentType {
  return typeof value === 'string' && (KNOWN_AGENT_TYPES as readonly string[]).includes(value)
}

// ── Status states ────────────────────────────────────────────────────────────

export const AGENT_STATUS_STATES = ['working', 'blocked', 'waiting', 'done'] as const

export type AgentStatusState = (typeof AGENT_STATUS_STATES)[number]
