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
