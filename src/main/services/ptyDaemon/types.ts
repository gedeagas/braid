/**
 * Shared types for the PTY daemon module.
 */

/** Information about an active PTY session in the daemon. */
export interface DaemonSession {
  sessionId: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
  /** Whether at least one client is currently attached to this session. */
  attached: boolean
}

/** Checkpoint data persisted to disk for cold restore. */
export interface CheckpointData {
  sessionId: string
  cwd: string
  cols: number
  rows: number
  scrollback: string
  createdAt: number
  checkpointedAt: number
}

/** Result of a reattach operation returned to the renderer. */
export interface ReattachResult {
  sessionId: string
  snapshot: string
}

/** Information about a session returned by list(). */
export interface SessionInfo {
  sessionId: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
}
