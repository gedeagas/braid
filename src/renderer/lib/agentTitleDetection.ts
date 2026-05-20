// ── Multi-Agent Title-based Status Detection ──────────────────────────────────
//
// Terminal agents (Claude, Gemini, Codex, Aider, etc.) set the terminal title
// via OSC 2 with Unicode markers or keywords indicating their status.
// This module detects those patterns and returns both status and agent type.
//
// Follows Orca's agent-detection.ts patterns for all supported agents.
// OSC 9999 (agentStatusOsc.ts) provides richer data when available via hooks.

import type { Terminal } from '@xterm/xterm'
import type { AgentStatusState, AgentType } from './agentStatus'

// ── Detection result ─────────────────────────────────────────────────────────

export interface TitleDetectionResult {
  state: AgentStatusState
  agentType: AgentType | null
}

// ── Per-agent Unicode markers ────────────────────────────────────────────────

// Claude Code: braille spinners when working, eight-spoked asterisk when idle
const BRAILLE_SPINNERS = new Set('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏')
const CLAUDE_IDLE = '✳' // U+2733 EIGHT SPOKED ASTERISK

// Gemini CLI: four-pointed star when working, diamond when idle, raised hand for permission
const GEMINI_WORKING = '✦'  // U+2726 FOUR POINTED BLACK STAR
const GEMINI_IDLE = '◇'     // U+25C7 WHITE DIAMOND
const GEMINI_PERMISSION = '✋' // U+270B RAISED HAND

// Codex CLI: uses similar braille spinners but also has specific title patterns
// Aider: sets title with status keywords

// ── Generic keyword patterns (fallback for unrecognized agents) ──────────────

const WORKING_KEYWORDS = /\b(working|thinking|running|generating|processing|executing)\b/i
const IDLE_KEYWORDS = /\b(ready|idle|done|completed|finished)\b/i
const WAITING_KEYWORDS = /\b(permission|waiting|blocked|confirm|approve|allow)\b/i

// ── Agent name detection from title body ─────────────────────────────────────

const AGENT_NAME_PATTERNS: Array<{ pattern: RegExp; type: AgentType }> = [
  { pattern: /\bclaude\b/i, type: 'claude' },
  { pattern: /\bcodex\b/i, type: 'codex' },
  { pattern: /\bgemini\b/i, type: 'gemini' },
  { pattern: /\bopencode\b/i, type: 'opencode' },
  { pattern: /\bcursor\b/i, type: 'cursor' },
  { pattern: /\bcopilot\b/i, type: 'copilot' },
  { pattern: /\baider\b/i, type: 'aider' },
  { pattern: /\bgrok\b/i, type: 'grok' },
  { pattern: /\bhermes\b/i, type: 'hermes' },
  { pattern: /\bdroid\b/i, type: 'droid' },
]

function detectAgentTypeFromTitle(title: string): AgentType | null {
  for (const { pattern, type } of AGENT_NAME_PATTERNS) {
    if (pattern.test(title)) return type
  }
  return null
}

// ── Main detection function ──────────────────────────────────────────────────

/**
 * Infer agent status and type from a terminal title string.
 * Returns null if the title doesn't match any known agent pattern.
 *
 * Detection priority:
 * 1. Agent-specific Unicode markers (most reliable)
 * 2. Generic status keywords (fallback)
 */
export function detectAgentStatusFromTitle(title: string): TitleDetectionResult | null {
  if (!title) return null
  const first = title.charAt(0)

  // ── Claude Code ──────────────────────────────────────────────────────────
  // Braille spinners = working
  if (BRAILLE_SPINNERS.has(first)) {
    return {
      state: 'working',
      agentType: detectAgentTypeFromTitle(title) ?? 'claude'
    }
  }
  // Idle marker
  if (first === CLAUDE_IDLE) {
    return { state: 'done', agentType: 'claude' }
  }

  // ── Gemini CLI ───────────────────────────────────────────────────────────
  if (first === GEMINI_WORKING) {
    return { state: 'working', agentType: 'gemini' }
  }
  if (first === GEMINI_IDLE) {
    return { state: 'done', agentType: 'gemini' }
  }
  if (first === GEMINI_PERMISSION) {
    return { state: 'waiting', agentType: 'gemini' }
  }

  // ── Question mark = waiting (many agents use this) ───────────────────────
  if (first === '?') {
    return {
      state: 'waiting',
      agentType: detectAgentTypeFromTitle(title)
    }
  }

  // ── Generic keyword-based detection ──────────────────────────────────────
  // Check for agent name in the title body to identify the agent type,
  // then use keyword matching for status.
  const agentType = detectAgentTypeFromTitle(title)

  if (WAITING_KEYWORDS.test(title)) {
    return { state: 'waiting', agentType }
  }
  if (WORKING_KEYWORDS.test(title)) {
    return { state: 'working', agentType }
  }
  if (IDLE_KEYWORDS.test(title)) {
    return { state: 'done', agentType }
  }

  // If we detected an agent name but no status keyword, the title is
  // informational - don't fire a status change.
  return null
}

// ── Registration helper ──────────────────────────────────────────────────────

/**
 * Register a title change listener on the terminal.
 * Fires onStatus whenever the title changes to a recognized agent status pattern.
 * Works for all supported agents (Claude, Gemini, Codex, Aider, etc.).
 */
export function registerTitleDetection(
  term: Terminal,
  onStatus: (result: TitleDetectionResult) => void
): void {
  term.onTitleChange((title) => {
    const result = detectAgentStatusFromTitle(title)
    if (result) onStatus(result)
  })
}
