/**
 * Manages all PTY sessions inside the daemon process.
 *
 * Each session has a node-pty instance and a RingBuffer holding
 * the last N characters of output for snapshot/reattach.
 */
import { accessSync, existsSync, constants as fsConstants } from 'fs'
import { BUFFER_MAX_LENGTH } from './protocol'
import { resolveShellLaunchArgs } from '../../lib/shell'
import { baseEnv, classifyForeground, normalizeForeground, persistableEnv } from './sessionEnv'
import type { DaemonSession, CheckpointData, SessionInfo, DaemonSessionMetadata, ForegroundKind } from './types'

export { persistableEnv } from './sessionEnv'

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
  /** Shell binary the PTY runs, to tell "at the prompt" from "running something". */
  shell: string
  /** Last sampled foreground (see sampleForeground). Undefined until sampled. */
  foreground?: ForegroundKind
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
      shell,
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
      shell,
      foreground: normalizeForeground(checkpoint.foreground),
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

  /** Cold-restore state for a session, as reported on attach. */
  coldRestoreInfo(sessionId: string): { coldRestored: boolean; foregroundAtLoss?: ForegroundKind } {
    const entry = this.sessions.get(sessionId)
    if (!entry?.coldRestored) return { coldRestored: false }
    return entry.foreground ? { coldRestored: true, foregroundAtLoss: entry.foreground } : { coldRestored: true }
  }

  /**
   * Record what each PTY has in the foreground: the bare shell (user is at the
   * prompt, e.g. after quitting the agent) or a command (the agent). Called on
   * the periodic checkpoint tick only, never during shutdown: on a reboot the
   * agent can die first and hand the foreground back to the shell, which must
   * not read as "the user quit it". Unclaimed cold-restored sessions keep the
   * value from before the loss.
   */
  sampleForeground(): void {
    for (const entry of this.sessions.values()) {
      if (entry.coldRestored) continue
      try {
        entry.foreground = classifyForeground(entry.pty.process, entry.shell)
      } catch {
        // PTY gone or platform without process info: keep the last sample.
      }
    }
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
        foreground: entry.foreground,
      })
    }
    return result
  }

  /** Number of active sessions. */
  get size(): number {
    return this.sessions.size
  }
}
