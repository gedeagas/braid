// ── OSC 9999 Agent Status Parser ──────────────────────────────────────────────
//
// Registers a custom OSC handler on xterm's built-in parser API.
// When an OSC 9999 sequence is received (e.g. from Claude Code hooks),
// the JSON payload is parsed and forwarded to the status callback.
// The sequence is consumed (returns true) so it never renders in the terminal.
//
// Payload format: \x1b]9999;{"state":"working",...}\x07
// xterm handles partial sequences, terminators (BEL/ST), and buffering for us.

import type { Terminal } from '@xterm/xterm'
import type { AgentStatusPayload, AgentStatusState } from './agentStatus'

const VALID_STATES = new Set<string>(['working', 'blocked', 'waiting', 'done'])

/**
 * Register an OSC 9999 handler on the given terminal.
 * Call once after terminal creation (before or after open - parser API is available immediately).
 */
export function registerAgentStatusOsc(
  term: Terminal,
  onStatus: (payload: AgentStatusPayload) => void
): void {
  term.parser.registerOscHandler(9999, (data: string) => {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      if (parsed && typeof parsed.state === 'string' && VALID_STATES.has(parsed.state)) {
        onStatus(parsed as unknown as AgentStatusPayload)
      }
    } catch {
      // Malformed JSON - ignore silently
    }
    return true // consume the sequence so it doesn't render
  })
}

/**
 * Register an OSC 9 handler that intercepts Braid-prefixed status payloads.
 * Format: \x1b]9;braid:STATE[:TOOL]\x07
 *
 * Claude Code hooks return this via the `terminalSequence` response field.
 * OSC 9 is in Claude Code's allowlist (alongside 0, 1, 2, 99, 777).
 *
 * Non-Braid OSC 9 sequences (e.g. iTerm2 notifications) are passed through
 * by returning false, so they still work normally.
 */
export function registerBraidOsc9(
  term: Terminal,
  onStatus: (payload: AgentStatusPayload) => void
): void {
  term.parser.registerOscHandler(9, (data: string) => {
    if (!data.startsWith('braid:')) return false // pass through non-Braid OSC 9

    const parts = data.split(':')
    // parts[0] = 'braid', parts[1] = state, parts[2] = tool name (optional)
    const state = parts[1]
    if (!VALID_STATES.has(state)) return true // consume malformed braid sequence

    const payload: AgentStatusPayload = {
      state: state as AgentStatusPayload['state'],
      agentType: 'claude',
      toolName: parts[2] || undefined,
    }
    onStatus(payload)
    return true // consume the sequence
  })
}

/**
 * Helper to emit an OSC 9999 sequence string (for testing or internal use).
 * Not used in production - Claude Code emits these via hooks.
 */
export function formatAgentStatusOsc(state: AgentStatusState): string {
  return `\x1b]9999;${JSON.stringify({ state })}\x07`
}
