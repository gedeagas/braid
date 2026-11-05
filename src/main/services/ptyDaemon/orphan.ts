/**
 * Orphan reaping eligibility for daemon sessions.
 *
 * Kept electron-free (no imports) so it can be unit-tested without pulling in
 * the main-process IPC/electron graph.
 */

/**
 * Whether a daemon session is eligible for orphan reaping. Desktop terminals key
 * their daemon session by the renderer's stable id: "bt-" (big terminals) and
 * "rt-" (right-panel terminals). Anonymous "pty-d-" sessions are ephemeral
 * (in-process / mobile) and never reaped this way.
 */
export function isReapableTerminalId(sessionId: string): boolean {
  return sessionId.startsWith('bt-') || sessionId.startsWith('rt-')
}

/**
 * Report big-terminal daemon sessions the desktop no longer tracks. The
 * renderer is authoritative for "what should exist" (its persisted tab lists),
 * so it passes the full set of known terminalIds and we return every live
 * session not in that set. Read-only - the caller decides what to reap.
 */
export function selectOrphanedSessions<S extends {
  sessionId: string
  cwd: string
  attachedClients: number
  metadata?: { label?: string; agentId?: string }
}>(sessions: readonly S[], knownTerminalIds: readonly string[]): Array<{ terminalId: string; cwd: string; label?: string; agentId?: string }> {
  const known = new Set(knownTerminalIds)
  return sessions
    .filter((session) =>
      // Both desktop terminal kinds key their daemon session by the renderer's
      // stable id: big terminals "bt-" and right-panel terminals "rt-". The
      // caller passes the known ids for both, so an unreferenced session of
      // either kind is an orphan the desktop no longer tracks.
      isReapableTerminalId(session.sessionId) &&
      !known.has(session.sessionId) &&
      // Safety interlock: never treat a session anyone is actively attached to
      // as an orphan, even if the renderer's persisted-id set is incomplete.
      // This is the guard that prevents reaping a terminal the user is viewing.
      session.attachedClients === 0)
    .map((session) => ({
      terminalId: session.sessionId,
      cwd: session.cwd,
      label: session.metadata?.label,
      agentId: session.metadata?.agentId,
    }))
}
