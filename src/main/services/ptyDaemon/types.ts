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

/**
 * Big-terminal display metadata. Persisted alongside the session so labels
 * (and agent/worktree association) survive an app restart - the daemon keeps
 * PTYs alive, but the Electron main process loses its in-memory metadata map.
 */
export interface DaemonSessionMetadata {
  label?: string
  agentId?: string
  worktreeId?: string
  /** Accumulated wall-clock time (ms) the agent has spent in the "working" state. */
  totalRunDurationMs?: number
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
  metadata?: DaemonSessionMetadata
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
  metadata?: DaemonSessionMetadata
  /** Number of clients currently attached (viewing) this session. 0 = nobody is
   *  looking at it right now, which is the safety signal for orphan cleanup. */
  attachedClients: number
}
