// ── Mobile terminal activity tracker ─────────────────────────────────────────
//
// Keeps a live, queryable snapshot of each big terminal's agent state off the
// hook status stream, so `terminal.list` can tell the mobile homepage which
// agents need attention (waiting for input / just finished) the moment a device
// connects - not only after a fresh event arrives over the socket.
//
// This is intentionally separate from `terminalNotifier`: the notifier dedups
// transitions to fire one-shot OS notifications, whereas this holds the current
// state for pull-based reads.

import { onHookStatus } from '../agentHookServer'

/** Coarsened agent state surfaced to mobile (the hook's 'blocked' folds into 'waiting'). */
export type TerminalActivity = 'working' | 'waiting' | 'done'

const activity = new Map<string, TerminalActivity>()

/** Current agent state for a big terminal, or undefined if none has been observed. */
export function getTerminalActivity(terminalId: string): TerminalActivity | undefined {
  return activity.get(terminalId)
}

/** Drop a terminal's tracked state (e.g. when its session is closed). */
export function clearTerminalActivity(terminalId: string): void {
  activity.delete(terminalId)
}

/**
 * Subscribe to hook status and record each terminal's latest agent state.
 * Returns an unsubscribe fn. A later 'working' overwrites a prior
 * 'waiting'/'done', so a terminal naturally drops out of the attention list
 * once its agent resumes.
 */
export function startTerminalActivityTracking(): () => void {
  return onHookStatus((status) => {
    // 'blocked' and 'waiting' both mean "needs the user"; normalize so the
    // mobile triage list groups them.
    const normalized = status.state === 'blocked' ? 'waiting' : status.state
    if (normalized !== 'working' && normalized !== 'waiting' && normalized !== 'done') return
    activity.set(status.terminalId, normalized)
  })
}
