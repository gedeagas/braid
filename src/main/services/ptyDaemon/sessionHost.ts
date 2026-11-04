/**
 * Manages all PTY sessions inside the daemon process.
 *
 * Each session has a node-pty instance and a RingBuffer holding
 * the last N characters of output for snapshot/reattach.
 */
import { accessSync, existsSync, constants as fsConstants } from 'fs'
import { BUFFER_MAX_LENGTH } from './protocol'
import { resolveShellLaunchArgs } from '../../lib/shell'
import type { DaemonSession, CheckpointData, SessionInfo, DaemonSessionMetadata } from './types'

// ── RingBuffer ───────────────────────────────────────────────────────────────

export class RingBuffer {
  private chunks: string[] = []
  private totalLength = 0
  private maxLength: number

  constructor(maxLength = BUFFER_MAX_LENGTH) {
    this.maxLength = Math.max(1, Math.round(maxLength))
  }

  push(data: string): void {
    this.chunks.push(data)
    this.totalLength += data.length
    this.trimToMaxLength()
  }

  setMaxLength(maxLength: number): void {
    this.maxLength = Math.max(1, Math.round(maxLength))
    this.trimToMaxLength()
  }

  private trimToMaxLength(): void {
    while (this.totalLength > this.maxLength && this.chunks.length > 1) {
      const evicted = this.chunks.shift()!
      this.totalLength -= evicted.length
    }
    if (this.totalLength > this.maxLength && this.chunks.length === 1) {
      this.chunks[0] = this.chunks[0].slice(this.chunks[0].length - this.maxLength)
      this.totalLength = this.chunks[0].length
    }
  }

  read(): string {
    return this.chunks.join('')
  }

  clear(): void {
    this.chunks = []
    this.totalLength = 0
  }
}

// ── Session entry ────────────────────────────────────────────────────────────

interface SessionEntry {
  sessionId: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
  lastOutputAt?: number
  pty: import('node-pty').IPty
  buffer: RingBuffer
  attachedClients: number
  /** Big-terminal display metadata (label/agent/worktree), persisted in checkpoints. */
  metadata?: DaemonSessionMetadata
  /** Allowlisted env re-applied when the session is restored from a checkpoint. */
  env: Record<string, string>
  /** Re-created from a checkpoint by this daemon and not yet claimed by a client. */
  coldRestored: boolean
  /** A client asked for this kill (tab closed), so the end is deliberate. */
  killRequested: boolean
}

// ── Persisted env ────────────────────────────────────────────────────────────

/**
 * Env keys that identify a Braid terminal and must survive a cold restore so
 * agent hooks keep reporting for it. Secrets (the hook token) are never
 * persisted: the hook script reads them from its own config file.
 */
const PERSISTED_ENV_KEYS = ['BRAID_TERMINAL_ID', 'BRAID_TERMINAL'] as const
const ENV_VALUE_RE = /^[A-Za-z0-9._:-]{1,256}$/

/**
 * The daemon's own env minus inherited Braid terminal identity. If Braid was
 * started from inside a Braid terminal, its env carries that terminal's id;
 * a new or restored shell must never report hooks under someone else's id.
 */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string>, TERM: 'xterm-256color' }
  for (const key of PERSISTED_ENV_KEYS) delete env[key]
  return env
}

/** Pick the env worth persisting. Also re-validates env read back from disk. */
export function persistableEnv(env: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!env || typeof env !== 'object') return result
  for (const key of PERSISTED_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && ENV_VALUE_RE.test(value)) result[key] = value
  }
  return result
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface SessionHostEvents {
  data: (sessionId: string, data: string) => void
  /**
   * `clean` is true when the shell ended by itself (user typed `exit`) or a
   * client asked for the kill, false when a signal killed it (logout, reboot).
   */
  exit: (sessionId: string, exitCode: number, clean: boolean) => void
}

type EventKey = keyof SessionHostEvents

// ── SessionHost ──────────────────────────────────────────────────────────────

export class SessionHost {
  private sessions = new Map<string, SessionEntry>()
  private listeners = new Map<EventKey, Set<(...args: unknown[]) => void>>()

  on<K extends EventKey>(event: K, fn: SessionHostEvents[K]): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn as (...args: unknown[]) => void)
  }

  private emit<K extends EventKey>(event: K, ...args: Parameters<SessionHostEvents[K]>): void {
    const set = this.listeners.get(event)
    if (set) {
      for (const fn of set) fn(...args)
    }
  }

  /**
   * Spawn a PTY with a single retry and enriched diagnostics on failure.
   * Transient posix_spawn failures (fd exhaustion, resource contention) often
   * resolve after a brief delay.
   */
  private async spawnPty(
    shell: string,
    args: string[],
    opts: { cols: number; rows: number; cwd: string; env: Record<string, string> },
  ): Promise<import('node-pty').IPty> {
    const nodePty = await import('node-pty')
    const maxAttempts = 2

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return nodePty.spawn(shell, args, { name: 'xterm-256color', ...opts })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Only retry transient posix_spawn resource contention, not permanent
        // config errors (invalid shell, bad permissions) which won't self-resolve.
        const isTransient = msg.includes('posix_spawnp failed')
        if (isTransient && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 200))
          continue
        }
        const diag = this.collectSpawnDiagnostics(shell, opts.cwd)
        throw new Error(
          `PTY spawn failed (shell: ${shell}, cwd: ${opts.cwd}, sessions: ${this.sessions.size}${diag}): ${msg}`,
          { cause: err },
        )
      }
    }
    throw new Error('unreachable')
  }

  private collectSpawnDiagnostics(shell: string, cwd: string): string {
    const parts: string[] = []
    // Only check shell executability for absolute/relative paths.
    // Bare command names (e.g. 'zsh', 'powershell.exe') are resolved via PATH by
    // node-pty, so accessSync would incorrectly report them as not-executable.
    // Match either separator so Windows paths (C:\...) are recognized too.
    if (/[\\/]/.test(shell)) {
      if (!existsSync(shell)) {
        parts.push('shell-check: not-found')
      } else {
        try {
          accessSync(shell, fsConstants.X_OK)
        } catch {
          parts.push('shell-check: not-executable')
        }
      }
    }
    if (!existsSync(cwd)) {
      parts.push('cwd-check: not-found')
    }
    return parts.length > 0 ? ', ' + parts.join(', ') : ''
  }

  /** Spawn a new PTY session. Throws if sessionId already exists. */
  async spawn(
    sessionId: string,
    cwd: string,
    cols: number,
    rows: number,
    shell: string,
    env?: Record<string, string>,
    bufferMaxLength = BUFFER_MAX_LENGTH,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`)
    }

    const ptyProcess = await this.spawnPty(shell, resolveShellLaunchArgs(shell).args, {
      cols,
      rows,
      cwd,
      env: { ...baseEnv(), ...env },
    })

    const buffer = new RingBuffer(bufferMaxLength)
    this.track({
      sessionId,
      cwd,
      cols,
      rows,
      createdAt: Date.now(),
      pty: ptyProcess,
      buffer,
      attachedClients: 0,
      env: persistableEnv(env),
      coldRestored: false,
      killRequested: false,
    })
  }

  /**
   * Restore a session from checkpoint data by spawning a fresh PTY
   * and pre-filling the RingBuffer with the checkpointed scrollback.
   * The session is flagged `coldRestored` until a client claims it.
   */
  async restore(checkpoint: CheckpointData, shell: string): Promise<void> {
    if (this.sessions.has(checkpoint.sessionId)) return

    const env = persistableEnv(checkpoint.env)
    const ptyProcess = await this.spawnPty(shell, resolveShellLaunchArgs(shell).args, {
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      cwd: checkpoint.cwd,
      env: { ...baseEnv(), ...env },
    })

    const buffer = new RingBuffer()
    buffer.push(checkpoint.scrollback)

    this.track({
      sessionId: checkpoint.sessionId,
      cwd: checkpoint.cwd,
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      createdAt: checkpoint.createdAt,
      lastOutputAt: checkpoint.lastOutputAt,
      pty: ptyProcess,
      buffer,
      attachedClients: 0,
      metadata: checkpoint.metadata,
      env,
      coldRestored: true,
      killRequested: false,
    })
  }

  private track(entry: SessionEntry): void {
    const { sessionId } = entry
    entry.pty.onData((data: string) => {
      entry.lastOutputAt = Date.now()
      entry.buffer.push(data)
      this.emit('data', sessionId, data)
    })

    entry.pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      this.sessions.delete(sessionId)
      this.emit('exit', sessionId, exitCode, entry.killRequested || !signal)
    })

    this.sessions.set(sessionId, entry)
  }

  /** Whether the session was cold-restored and nobody has claimed it yet. */
  isColdRestored(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.coldRestored ?? false
  }

  /**
   * Atomically claim a cold-restored session. Returns true for exactly one
   * caller, so two windows (or desktop + mobile) can't both relaunch the agent.
   */
  consumeColdRestore(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId)
    if (!entry?.coldRestored) return false
    entry.coldRestored = false
    return true
  }

  /** Write data to a session's PTY stdin. */
  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.pty.write(data)
  }

  /** Resize a session's PTY. */
  resize(sessionId: string, cols: number, rows: number): void {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.pty.resize(cols, rows)
      entry.cols = cols
      entry.rows = rows
    }
  }

  /** Kill a session's PTY. The 'exit' event fires when it dies. */
  kill(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.killRequested = true
    entry.pty.kill()
  }

  /** Kill all sessions (on daemon shutdown). */
  killAll(): void {
    for (const entry of this.sessions.values()) {
      entry.pty.kill()
    }
  }

  /** Mark a client as attached to a session. Returns the snapshot. */
  attach(sessionId: string): string | null {
    const entry = this.sessions.get(sessionId)
    if (!entry) return null
    entry.attachedClients++
    return entry.buffer.read()
  }

  /** Mark a client as detached from a session. */
  detach(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (entry && entry.attachedClients > 0) {
      entry.attachedClients--
    }
  }

  /** Detach from all sessions (when a client disconnects). */
  detachAll(sessionIds: Set<string>): void {
    for (const id of sessionIds) {
      this.detach(id)
    }
  }

  /** Get the current snapshot (RingBuffer contents) for a session. */
  snapshot(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.buffer.read() ?? null
  }

  setBufferMaxLength(maxLength: number): void {
    for (const entry of this.sessions.values()) {
      entry.buffer.setMaxLength(maxLength)
    }
  }

  /** Check if a session exists. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** Attach/replace big-terminal display metadata for a session. No-op if unknown. */
  setMetadata(sessionId: string, metadata: DaemonSessionMetadata): void {
    const entry = this.sessions.get(sessionId)
    if (entry) entry.metadata = metadata
  }

  /** List all active sessions. */
  list(): SessionInfo[] {
    const result: SessionInfo[] = []
    for (const entry of this.sessions.values()) {
      result.push({
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        cols: entry.cols,
        rows: entry.rows,
        createdAt: entry.createdAt,
        lastOutputAt: entry.lastOutputAt,
        metadata: entry.metadata,
        attachedClients: entry.attachedClients,
        coldRestored: entry.coldRestored,
      })
    }
    return result
  }

  /** Get checkpoint data for all sessions (for periodic persistence). */
  getCheckpoints(): CheckpointData[] {
    const now = Date.now()
    const result: CheckpointData[] = []
    for (const entry of this.sessions.values()) {
      result.push({
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        cols: entry.cols,
        rows: entry.rows,
        scrollback: entry.buffer.read(),
        createdAt: entry.createdAt,
        lastOutputAt: entry.lastOutputAt,
        checkpointedAt: now,
        metadata: entry.metadata,
        env: entry.env,
      })
    }
    return result
  }

  /** Number of active sessions. */
  get size(): number {
    return this.sessions.size
  }
}
