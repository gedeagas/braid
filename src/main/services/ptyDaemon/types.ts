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
  lastOutputAt?: number
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

/**
 * What a PTY had in the foreground: the bare shell at its prompt, or a command
 * (typically the agent). Sampled with each periodic checkpoint.
 */
export type ForegroundKind = 'shell' | 'command'

/** Checkpoint data persisted to disk for cold restore. */
export interface CheckpointData {
  sessionId: string
  cwd: string
  cols: number
  rows: number
  scrollback: string
  createdAt: number
  lastOutputAt?: number
  checkpointedAt: number
  metadata?: DaemonSessionMetadata
  /** Allowlisted Braid env (terminal id) re-applied on restore. */
  env?: Record<string, string>
  /** Foreground at the last periodic sample before the checkpoint. */
  foreground?: ForegroundKind
}

/** Result of a reattach operation returned to the renderer. */
export interface ReattachResult {
  sessionId: string
  snapshot: string
  /**
   * The daemon re-created this session from a checkpoint (the original shell
   * and anything running in it are gone). Claim it with consumeColdRestore
   * before relaunching the agent.
   */
  coldRestored?: boolean
  /**
   * Foreground when the old daemon died. `shell` means the user had already
   * left the agent, so it must not be relaunched. Absent when unknown.
   */
  foregroundAtLoss?: ForegroundKind
}

/** Information about a session returned by list(). */
export interface SessionInfo {
  sessionId: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
  lastOutputAt?: number
  metadata?: DaemonSessionMetadata
  /** Number of clients currently attached (viewing) this session. 0 = nobody is
   *  looking at it right now, which is the safety signal for orphan cleanup. */
  attachedClients: number
  /** Re-created from a checkpoint and not yet claimed (see ReattachResult). */
  coldRestored?: boolean
}
