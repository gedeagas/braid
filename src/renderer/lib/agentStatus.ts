// ── Agent Status Types ────────────────────────────────────────────────────────
//
// Shared types for terminal agent status tracking via OSC 9999 sequences
// and title-based detection. Supports Claude, Codex, Gemini, Aider, Copilot,
// and other CLI agents.

// ── Agent types ──────────────────────────────────────────────────────────────

export const KNOWN_AGENT_TYPES = [
  'claude', 'codex', 'gemini', 'antigravity', 'opencode', 'cursor', 'copilot',
  'aider', 'pi', 'droid', 'grok', 'hermes', 'unknown'
] as const

export type AgentType = (typeof KNOWN_AGENT_TYPES)[number]

// ── Status states ────────────────────────────────────────────────────────────

export const AGENT_STATUS_STATES = ['working', 'blocked', 'waiting', 'done'] as const

export type AgentStatusState = (typeof AGENT_STATUS_STATES)[number]

// ── Payloads ─────────────────────────────────────────────────────────────────

/** Payload from an OSC 9999 sequence or title-based detection. */
export interface AgentStatusPayload {
  state: AgentStatusState
  /** Agent type identifier, e.g. 'claude', 'codex', 'gemini'. */
  agentType?: AgentType
  /** Tool currently being executed, e.g. "Edit", "Bash". */
  toolName?: string
  /** Preview of tool input, e.g. file path or command. */
  toolInput?: string
  /** Last assistant message text (up to 8000 chars). */
  lastAssistantMessage?: string
  /** User's current prompt (cached across tool calls in the same turn). */
  prompt?: string
  /** True when the agent was interrupted (Ctrl+C) rather than completing normally. */
  interrupted?: boolean
}

// ── Store entry ──────────────────────────────────────────────────────────────

/** Rolling history entry for a single state transition. */
export interface AgentStateHistoryEntry {
  state: AgentStatusState
  timestamp: number
}

const MAX_HISTORY = 20

/**
 * Full status entry stored per terminal in Zustand.
 * Tracks current state, detected agent type, and rolling history.
 */
export interface AgentStatusEntry {
  state: AgentStatusState
  agentType: AgentType | null
  toolName: string | null
  /** Rolling history of recent state transitions (max 20). */
  stateHistory: AgentStateHistoryEntry[]
  /** Timestamp of the last status update. */
  updatedAt: number
}

/** Create an initial (empty) status entry. */
export function createAgentStatusEntry(
  state: AgentStatusState,
  agentType?: AgentType
): AgentStatusEntry {
  return {
    state,
    agentType: agentType ?? null,
    toolName: null,
    stateHistory: [{ state, timestamp: Date.now() }],
    updatedAt: Date.now()
  }
}

/** Update an existing entry with a new payload, preserving rolling history. */
export function updateAgentStatusEntry(
  prev: AgentStatusEntry,
  payload: AgentStatusPayload
): AgentStatusEntry {
  const now = Date.now()
  const history = [...prev.stateHistory, { state: payload.state, timestamp: now }]
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)

  return {
    state: payload.state,
    agentType: payload.agentType ?? prev.agentType,
    toolName: payload.toolName !== undefined ? payload.toolName : prev.toolName,
    stateHistory: history,
    updatedAt: now
  }
}

// ── Tab CSS mapping ──────────────────────────────────────────────────────────

/**
 * Map an AgentStatusState to a CSS class for terminal tabs.
 * Reuses the existing tab status classes from tabs.css:
 *   - tab--running: slow breathing animation ("working in the background")
 *   - tab--waiting: faster pulse animation ("hey, I need you")
 */
export function agentStatusToTabClass(entry: AgentStatusEntry | null): string {
  if (!entry) return ''
  if (entry.state === 'working') return ' tab--running'
  if (entry.state === 'blocked' || entry.state === 'waiting') return ' tab--waiting'
  return '' // done = no animation
}
