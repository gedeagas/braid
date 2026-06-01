// ── Terminal agent run-time tracker ──────────────────────────────────────────
//
// Measures wall-clock time each big-terminal agent spends in the "working"
// state and accumulates it into the terminal's persisted metadata
// (totalRunDurationMs). This is the terminal-agent equivalent of an SDK
// session's run duration and feeds the mobile homepage "Agent time" stat.
//
// Runs in the main process off the agent hook status stream (onHookStatus), not
// the renderer: timing stays accurate even for phone-driven terminals the
// desktop never mounted (the renderer hook listener drops status for unmounted
// terminals).

import { onHookStatus, type AgentHookStatus } from './agentHookServer'
import { ptyService } from './pty'

/** terminalId -> timestamp (ms) when the current "working" span began. */
const runningSince = new Map<string, number>()

function handleStatus(status: AgentHookStatus): void {
  const { terminalId, state } = status
  if (!terminalId) return

  if (state === 'working') {
    // Start a span on the first "working" event; ignore repeats (PreToolUse,
    // PostToolUse, etc. all map to "working" and fire many times per turn).
    if (!runningSince.has(terminalId)) runningSince.set(terminalId, Date.now())
    return
  }

  // Any non-working state (blocked / waiting / done) ends the span.
  const startedAt = runningSince.get(terminalId)
  if (startedAt == null) return
  runningSince.delete(terminalId)
  ptyService.addBigTerminalRunDuration?.(terminalId, Date.now() - startedAt)
}

/** Subscribe to hook status and accumulate agent run time. Returns an unsubscribe fn. */
export function startTerminalRunTimer(): () => void {
  return onHookStatus(handleStatus)
}
