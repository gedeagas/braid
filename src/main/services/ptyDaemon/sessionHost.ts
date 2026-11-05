/**
 * Manages all PTY sessions inside the daemon process.
 *
 * Each session has a node-pty instance, a RingBuffer holding the last N
 * characters of output for snapshot/reattach, and a headless terminal with its
 * screen state (SessionScreen) for clients that stop receiving output for
 * terminals nobody looks at.
 */
import { BUFFER_MAX_LENGTH, type AgentStatusEvent, type HeadlessSnapshot, type TerminalColors } from './protocol'
import { SessionScreen, type VisibleOptions } from './headless/sessionScreen'

/**
 * Headless screens keep at most this much scrollback: the terminal setting
 * (50,000 lines by default) would cost the daemon hundreds of MB per busy
 * hidden terminal. A revealed terminal shows this much history above the
 * screen; the full raw output stays in the ring buffers.
 */
export const HEADLESS_SCROLLBACK_MAX_LINES = 5_000
const headlessScrollback = (lines: number): number => Math.max(1, Math.min(lines, HEADLESS_SCROLLBACK_MAX_LINES))
import { RingBuffer } from './ringBuffer'
import { spawnPty } from './spawnPty'
import { PauseValve } from './delivery/pauseValve'
import { ExitedScreens } from './headless/exitedScreens'
import { resolveShellLaunchArgs } from '../../lib/shell'
import { baseEnv, classifyForeground, normalizeForeground, persistableEnv, restoredEnv } from './sessionEnv'
import type { DaemonSession, CheckpointData, SessionInfo, DaemonSessionMetadata, ForegroundKind } from './types'

export { persistableEnv } from './sessionEnv'
export { RingBuffer } from './ringBuffer'

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
  /** Headless screen state, output seq, query answering, agent status. */
  screen: SessionScreen
}

/** Options a newer client may pass; older clients send none. */
export interface SpawnExtras {
  /** Headless scrollback in lines. */
  scrollback?: number
  /** Client that delivers this session's output to a renderer from the start. */
  visibleBy?: unknown
}

type NewEntry = Omit<SessionEntry, 'screen'>

// ── Events ───────────────────────────────────────────────────────────────────

export interface SessionHostEvents {
  data: (sessionId: string, data: string, seq: number) => void
  /** Agent status detected in the session's output. */
  status: (event: AgentStatusEvent) => void
  /**
   * `clean` is true when the shell ended by itself (user typed `exit`) or a
   * client asked for the kill, false when a signal killed it (logout, reboot).
   */
  exit: (sessionId: string, exitCode: number, clean: boolean, selfExit: boolean) => void
}

type EventKey = keyof SessionHostEvents

// ── SessionHost ──────────────────────────────────────────────────────────────

export class SessionHost {
  private sessions = new Map<string, SessionEntry>()
  private listeners = new Map<EventKey, Set<(...args: unknown[]) => void>>()
  /** Client-requested PTY pauses (flow control), with a safety valve. */
  /** Screens of sessions that just exited, for a final snapshot. */
  private exited = new ExitedScreens()
  private valve = new PauseValve((id) => {
    const screen = this.sessions.get(id)?.screen
    return screen && { pause: () => screen.setClientPaused(true), resume: () => screen.setClientPaused(false) }
  })
  /** Headless scrollback for sessions spawned without one (cold restore). */
  private scrollbackLines = HEADLESS_SCROLLBACK_MAX_LINES
  /** The renderer's terminal colours, for OSC 10/11/12 replies from hidden terminals. */
  private colors: TerminalColors | null = null

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

  /** Spawn a new PTY session. Throws if sessionId already exists. */
  async spawn(
    sessionId: string,
    cwd: string,
    cols: number,
    rows: number,
    shell: string,
    env?: Record<string, string>,
    bufferMaxLength = BUFFER_MAX_LENGTH,
    extras: SpawnExtras = {},
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`)
    }

    const ptyProcess = await spawnPty(shell, resolveShellLaunchArgs(shell).args, {
      cols,
      rows,
      cwd,
      env: { ...baseEnv(), ...env },
    }, { sessionCount: this.sessions.size })

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
    }, extras)
  }

  /**
   * Restore a session from checkpoint data by spawning a fresh PTY
   * and pre-filling the RingBuffer with the checkpointed scrollback.
   * The session is flagged `coldRestored` until a client claims it.
   */
  async restore(checkpoint: CheckpointData, shell: string): Promise<void> {
    if (this.sessions.has(checkpoint.sessionId)) return

    const env = restoredEnv(checkpoint.sessionId, checkpoint.env)
    const ptyProcess = await spawnPty(shell, resolveShellLaunchArgs(shell).args, {
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      cwd: checkpoint.cwd,
      env: { ...baseEnv(), ...env },
    }, { sessionCount: this.sessions.size })

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
    }, {}, checkpoint.scrollback)
  }

  private track(fields: NewEntry, extras: SpawnExtras, seed?: string): void {
    const { sessionId } = fields
    const entry: SessionEntry = fields as SessionEntry
    entry.screen = new SessionScreen(fields.pty, {
      cols: fields.cols, rows: fields.rows, scrollback: headlessScrollback(extras.scrollback ?? this.scrollbackLines),
    }, {
      status: (event) => this.emit('status', { type: 'status', sessionId, ...event }),
      expectedAgentType: () => entry.metadata?.agentId,
      colors: () => this.colors,
    })
    if (extras.visibleBy !== undefined) entry.screen.setVisible(extras.visibleBy, true)
    // Cold restore: the headless screen starts from the checkpoint, like the
    // ring buffer (this also covers checkpoints written by older daemons).
    if (seed) entry.screen.seed(seed)
    entry.pty.onData((data: string) => {
      entry.lastOutputAt = Date.now()
      entry.buffer.push(data)
      const seq = entry.screen.output(data)
      this.emit('data', sessionId, data, seq)
    })

    entry.pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      this.sessions.delete(sessionId)
      this.valve.forget(sessionId)
      this.exited.keep(sessionId, entry.screen) // for a final snapshot
      // selfExit: the shell ended on its own (user typed `exit`), not by a
      // signal and not by a client kill (tab close, hibernation).
      this.emit('exit', sessionId, exitCode, entry.killRequested || !signal, !signal && !entry.killRequested)
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

  /**
   * Stop reading a session's PTY on behalf of `owner` (a client whose consumer
   * fell behind). The program blocks once the kernel buffer fills. Released
   * by resume(), releasePauses() on disconnect, or the valve's 10s timeout.
   */
  pause(sessionId: string, owner: unknown): void {
    this.valve.pause(sessionId, owner)
  }

  resume(sessionId: string, owner: unknown): void {
    this.valve.resume(sessionId, owner)
  }

  /** A client disconnected: release its pauses; it no longer shows anything. */
  releaseClient(owner: unknown): void {
    this.valve.releaseOwner(owner)
    for (const entry of this.sessions.values()) entry.screen.releaseOwner(owner)
  }

  /** Whether `owner` delivers this session's output to a renderer. Returns the show point (see SessionScreen). */
  setVisible(sessionId: string, owner: unknown, visible: boolean, opts: VisibleOptions = {}): number {
    return this.sessions.get(sessionId)?.screen.setVisible(owner, visible, opts) ?? 0
  }

  /** Screen snapshot of the session's headless terminal, or null if unknown. `owner`: the requesting client. */
  async headlessSnapshot(sessionId: string, owner?: unknown): Promise<HeadlessSnapshot | null> {
    const entry = this.sessions.get(sessionId)
    return entry ? entry.screen.snapshot(owner) : this.exited.snapshot(sessionId)
  }

  /** Stop timers (daemon shutdown, tests). */
  dispose(): void {
    this.valve.dispose()
    for (const entry of this.sessions.values()) entry.screen.dispose()
    this.exited.dispose()
  }

  /** Resize a session's PTY. */
  resize(sessionId: string, cols: number, rows: number): void {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.pty.resize(cols, rows)
      entry.screen.resize(cols, rows)
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

  setBufferMaxLength(maxLength: number, scrollbackLines?: number): void {
    if (scrollbackLines !== undefined && scrollbackLines > 0) this.scrollbackLines = scrollbackLines
    for (const entry of this.sessions.values()) {
      entry.buffer.setMaxLength(maxLength)
      if (scrollbackLines !== undefined && scrollbackLines > 0) entry.screen.setScrollback(headlessScrollback(scrollbackLines))
    }
  }

  /** The renderer's terminal colours (pushed on startup and theme change). */
  setColors(colors: TerminalColors): void {
    this.colors = colors
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
        ...(entry.foreground ? { foreground: entry.foreground } : {}),
        ...(entry.screen.lastStatus ? { agentStatus: entry.screen.lastStatus } : {}),
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
