/**
 * Manages all PTY sessions inside the daemon process.
 *
 * Each session has a node-pty instance and a RingBuffer holding
 * the last N characters of output for snapshot/reattach.
 */
import { accessSync, existsSync, constants as fsConstants } from 'fs'
import { BUFFER_MAX_LENGTH } from './protocol'
import type { DaemonSession, CheckpointData, SessionInfo } from './types'

// ── RingBuffer ───────────────────────────────────────────────────────────────

export class RingBuffer {
  private chunks: string[] = []
  private totalLength = 0

  push(data: string): void {
    this.chunks.push(data)
    this.totalLength += data.length
    while (this.totalLength > BUFFER_MAX_LENGTH && this.chunks.length > 1) {
      const evicted = this.chunks.shift()!
      this.totalLength -= evicted.length
    }
    if (this.totalLength > BUFFER_MAX_LENGTH && this.chunks.length === 1) {
      this.chunks[0] = this.chunks[0].slice(this.chunks[0].length - BUFFER_MAX_LENGTH)
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
  pty: import('node-pty').IPty
  buffer: RingBuffer
  attachedClients: number
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface SessionHostEvents {
  data: (sessionId: string, data: string) => void
  exit: (sessionId: string, exitCode: number) => void
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
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 200))
          continue
        }
        const msg = err instanceof Error ? err.message : String(err)
        const diag = this.collectSpawnDiagnostics(shell, opts.cwd)
        throw new Error(
          `PTY spawn failed (shell: ${shell}, cwd: ${opts.cwd}, sessions: ${this.sessions.size}${diag}): ${msg}`,
        )
      }
    }
    throw new Error('unreachable')
  }

  private collectSpawnDiagnostics(shell: string, cwd: string): string {
    const parts: string[] = []
    try {
      accessSync(shell, fsConstants.X_OK)
    } catch {
      parts.push('shell-check: not-executable')
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
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`)
    }

    const ptyProcess = await this.spawnPty(shell, ['-l'], {
      cols,
      rows,
      cwd,
      env: {
        ...process.env as Record<string, string>,
        TERM: 'xterm-256color',
        ...env,
      },
    })

    const buffer = new RingBuffer()
    const entry: SessionEntry = {
      sessionId,
      cwd,
      cols,
      rows,
      createdAt: Date.now(),
      pty: ptyProcess,
      buffer,
      attachedClients: 0,
    }

    ptyProcess.onData((data: string) => {
      buffer.push(data)
      this.emit('data', sessionId, data)
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.sessions.delete(sessionId)
      this.emit('exit', sessionId, exitCode)
    })

    this.sessions.set(sessionId, entry)
  }

  /**
   * Restore a session from checkpoint data by spawning a fresh PTY
   * and pre-filling the RingBuffer with the checkpointed scrollback.
   */
  async restore(checkpoint: CheckpointData, shell: string): Promise<void> {
    if (this.sessions.has(checkpoint.sessionId)) return

    const ptyProcess = await this.spawnPty(shell, ['-l'], {
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      cwd: checkpoint.cwd,
      env: {
        ...process.env as Record<string, string>,
        TERM: 'xterm-256color',
      },
    })

    const buffer = new RingBuffer()
    buffer.push(checkpoint.scrollback)

    const entry: SessionEntry = {
      sessionId: checkpoint.sessionId,
      cwd: checkpoint.cwd,
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      createdAt: checkpoint.createdAt,
      pty: ptyProcess,
      buffer,
      attachedClients: 0,
    }

    ptyProcess.onData((data: string) => {
      buffer.push(data)
      this.emit('data', checkpoint.sessionId, data)
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.sessions.delete(checkpoint.sessionId)
      this.emit('exit', checkpoint.sessionId, exitCode)
    })

    this.sessions.set(checkpoint.sessionId, entry)
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
    this.sessions.get(sessionId)?.pty.kill()
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

  /** Check if a session exists. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
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
        checkpointedAt: now,
      })
    }
    return result
  }

  /** Number of active sessions. */
  get size(): number {
    return this.sessions.size
  }
}
