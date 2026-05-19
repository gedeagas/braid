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
 * Helper to emit an OSC 9999 sequence string (for testing or internal use).
 * Not used in production - Claude Code emits these via hooks.
 */
export function formatAgentStatusOsc(state: AgentStatusState): string {
  return `\x1b]9999;${JSON.stringify({ state })}\x07`
}
