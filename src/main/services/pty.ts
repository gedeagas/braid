import { BrowserWindow, app } from 'electron'
import { existsSync, accessSync, constants, lstatSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { mainSettings } from '../ipc'
import { getHookServerPort, getHookServerToken } from './agentHookServer'
import { DEFAULT_TERMINAL_SCROLLBACK_LINES, getTerminalScrollbackBufferMaxLength } from '../../shared/terminal'

// ── Big Terminal scrollback persistence ──────────────────────────────────────

function scrollbackDir(): string {
  return join(homedir(), 'Braid', 'bigTerminals')
}

function scrollbackPath(terminalId: string): string {
  // Strict allowlist: terminalId must match our generated format (bt-<digits>-<digits>).
  // Anything else is rejected to prevent path traversal.
  if (!/^bt-\d+-\d+$/.test(terminalId)) {
    throw new Error(`Invalid terminal id: ${terminalId}`)
  }
  return join(scrollbackDir(), `${terminalId}.scrollback`)
}

// ── Ring Buffer ──────────────────────────────────────────────────────────────

const DEFAULT_BUFFER_MAX_LENGTH = getTerminalScrollbackBufferMaxLength(DEFAULT_TERMINAL_SCROLLBACK_LINES)

/** Bounded ring buffer that stores the last N characters of terminal output. */
class RingBuffer {
  private chunks: string[] = []
  private totalLength = 0
  private maxLength: number

  constructor(maxLength = DEFAULT_BUFFER_MAX_LENGTH) {
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
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PtyInstance {
  process: import('node-pty').IPty
  cwd: string
  buffer: RingBuffer
  cols: number
  rows: number
}

export interface BigTerminalMetadata {
  terminalId: string
  worktreeId?: string
  label?: string
  agentId?: string
  /** Accumulated wall-clock time (ms) the agent has spent in the "working" state. */
  totalRunDurationMs?: number
}

export interface PtyInstanceInfo {
  ptyId: string
  cwd: string
  terminalId?: string
  title?: string
  label?: string
  agentId?: string
  worktreeId?: string
  /** Accumulated wall-clock time (ms) the agent has spent in the "working" state. */
  totalRunDurationMs?: number
}

export interface TerminalOutput {
  ptyId: string
  output: string
}

export interface IPtyService {
  /** Spawn a new interactive terminal session in the given directory. Returns a session ID.
   *  Optional envOverrides are merged into the PTY environment (e.g. BRAID_TERMINAL_ID). */
  spawn(cwd: string, envOverrides?: Record<string, string>): Promise<string>
  /** Write raw input to the terminal session. */
  write(id: string, data: string): void
  /** Resize the terminal session to the given dimensions. */
  resize(id: string, cols: number, rows: number): void
  /** Kill a specific terminal session. */
  kill(id: string): void
  /** Kill a big terminal by its stable terminalId (bt-...), regardless of ptyId.
   *  Used to reliably reap a session on tab close even when no renderer has it cached. */
  killBigTerminal?(terminalId: string): void
  /** Kill all active terminal sessions. */
  killAll(): void
  /** Run a command non-interactively and resolve when it exits. */
  runScript(cwd: string, command: string, timeoutMs?: number): Promise<{ exitCode: number }>
  /** Read buffered output from all PTYs spawned in the given worktree path. */
  readTerminalOutput(worktreePath: string): TerminalOutput[]
  /** Update how much output is retained for reconnect/restart snapshots. */
  setScrollbackBufferMaxLength(maxLength: number): void
  /** Associate a ptyId with a persistent big-terminal id so the RingBuffer is flushed to disk on exit/shutdown. */
  registerBigTerminal(ptyId: string, terminalId: string): void
  /** Read the persisted scrollback for a big terminal. Returns empty string if none exists. */
  readScrollback(terminalId: string): string
  /** Delete the persisted scrollback file for a big terminal. */
  deleteScrollback(terminalId: string): void
  /** Flush all live big-terminal PTYs' RingBuffers to disk. Called on app quit. */
  dumpAllScrollbacks(): void
  /** Subscribe to raw data from a PTY. Returns an unsubscribe function. */
  onData(ptyId: string, callback: (ptyId: string, data: string) => void): () => void
  /** Subscribe to exit events from a PTY. Returns an unsubscribe function. */
  onExit(ptyId: string, callback: (ptyId: string, exitCode: number) => void): () => void
  /** Subscribe to resize events from a PTY (fires with the new dimensions). Returns an unsubscribe function. */
  onResize?(ptyId: string, callback: (ptyId: string, cols: number, rows: number) => void): () => void
  /** Current dimensions of a PTY, or null if unknown. */
  getSize?(ptyId: string): { cols: number; rows: number } | null
  /** List active PTY instances, optionally filtered by worktree path. */
  listInstances(worktreePath?: string): PtyInstanceInfo[]
  setBigTerminalMetadata?(metadata: BigTerminalMetadata): void
  removeBigTerminalMetadata?(terminalId: string): void
  /** Add elapsed "working" time (ms) to a big terminal's accumulated run duration. */
  addBigTerminalRunDuration?(terminalId: string, deltaMs: number): void
  /** List active PTY instances with their OS process IDs. */
  listInstancesWithPid(): Array<{ ptyId: string; cwd: string; pid: number | null }>
}

// ── Legacy in-process service ────────────────────────────────────────────────

class PtyService implements IPtyService {
  private instances = new Map<string, PtyInstance>()
  private counter = 0
  /** Mapping ptyId -> terminalId for big terminal PTYs (for scrollback persistence). */
  private bigTerminalByPty = new Map<string, string>()
  private bigTerminalMetadataById = new Map<string, BigTerminalMetadata>()
  /** External data listeners (e.g. mobile companion server). */
  private dataListeners = new Map<string, Set<(ptyId: string, data: string) => void>>()
  /** External exit listeners (e.g. mobile companion server). */
  private exitListeners = new Map<string, Set<(ptyId: string, exitCode: number) => void>>()
  /** External resize listeners (e.g. mobile companion server). */
  private resizeListeners = new Map<string, Set<(ptyId: string, cols: number, rows: number) => void>>()

  private getWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows()
    return windows[0] ?? null
  }

  private isExecutable(path: string): boolean {
    try {
      // Resolve symlinks - catches dangling Homebrew links
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        if (!existsSync(path)) return false // dangling symlink
      }
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  private resolveShell(): string {
    const configured = mainSettings.terminalShell
    if (configured && this.isExecutable(configured)) return configured
    if (process.env.SHELL && this.isExecutable(process.env.SHELL)) return process.env.SHELL
    // Last resort: ask the system for the user's login shell
    try {
      const result = execFileSync('dscl', ['.', '-read', `/Users/${process.env.USER ?? 'root'}`, 'UserShell'], { encoding: 'utf8', timeout: 2000 })
      const match = result.match(/UserShell:\s*(\S+)/)
      if (match && this.isExecutable(match[1])) return match[1]
    } catch { /* ignore */ }
    return '/bin/zsh'
  }

  async spawn(cwd: string, envOverrides?: Record<string, string>): Promise<string> {
    const nodePty = await import('node-pty')
    const id = `pty-${++this.counter}`
    const shell = this.resolveShell()
    const safeCwd = existsSync(cwd) ? cwd : homedir()

    // Build PTY environment: base env + hook server details + caller overrides
    const hookPort = getHookServerPort()
    const hookToken = getHookServerToken()
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      BRAID_TERMINAL: '1',
      ...(hookPort > 0 ? { BRAID_HOOK_PORT: String(hookPort), BRAID_HOOK_TOKEN: hookToken } : {}),
      ...envOverrides,
    }

    let ptyProcess: import('node-pty').IPty
    try {
      ptyProcess = nodePty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: safeCwd,
        env,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Failed to spawn terminal (shell: ${shell}, cwd: ${safeCwd}): ${msg}. ` +
        `Check that the shell binary exists and is executable.`
      )
    }

    const buffer = new RingBuffer(getTerminalScrollbackBufferMaxLength(mainSettings.terminalScrollback))
    const instance: PtyInstance = { process: ptyProcess, cwd: safeCwd, buffer, cols: 80, rows: 24 }

    ptyProcess.onData((data: string) => {
      buffer.push(data)
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:data', id, data)
      }
      // Notify external listeners (mobile companion)
      for (const cb of this.dataListeners.get(id) ?? []) cb(id, data)
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      // Persist scrollback for big terminals before removing the instance
      const terminalId = this.bigTerminalByPty.get(id)
      if (terminalId) this.writeScrollbackFile(terminalId, buffer.read())
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:exit', id, exitCode)
      }
      // Notify external listeners (mobile companion)
      for (const cb of this.exitListeners.get(id) ?? []) cb(id, exitCode)
      this.instances.delete(id)
      this.bigTerminalByPty.delete(id)
      // Clean up listener sets
      this.dataListeners.delete(id)
      this.exitListeners.delete(id)
      this.resizeListeners.delete(id)
    })

    this.instances.set(id, instance)
    return id
  }

  write(id: string, data: string): void {
    this.instances.get(id)?.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (!instance) return
    instance.process.resize(cols, rows)
    instance.cols = cols
    instance.rows = rows
    for (const cb of this.resizeListeners.get(id) ?? []) cb(id, cols, rows)
  }

  getSize(id: string): { cols: number; rows: number } | null {
    const instance = this.instances.get(id)
    return instance ? { cols: instance.cols, rows: instance.rows } : null
  }

  onResize(ptyId: string, callback: (ptyId: string, cols: number, rows: number) => void): () => void {
    if (!this.resizeListeners.has(ptyId)) this.resizeListeners.set(ptyId, new Set())
    this.resizeListeners.get(ptyId)!.add(callback)
    return () => { this.resizeListeners.get(ptyId)?.delete(callback) }
  }

  kill(id: string): void {
    // Persist scrollback for big terminals before killing (onExit may not fire reliably on kill)
    const terminalId = this.bigTerminalByPty.get(id)
    const instance = this.instances.get(id)
    if (terminalId && instance) this.writeScrollbackFile(terminalId, instance.buffer.read())
    instance?.process.kill()
    this.instances.delete(id)
    this.bigTerminalByPty.delete(id)
  }

  killBigTerminal(terminalId: string): void {
    // Reverse-lookup the ptyId from the terminalId so a tab close can reap the
    // PTY even when the renderer never mounted (and thus never cached) it.
    for (const [ptyId, tid] of this.bigTerminalByPty) {
      if (tid === terminalId) {
        this.kill(ptyId)
        break
      }
    }
    this.bigTerminalMetadataById.delete(terminalId)
  }

  killAll(): void {
    for (const [id] of this.instances) {
      this.kill(id)
    }
  }

  readTerminalOutput(worktreePath: string): TerminalOutput[] {
    const results: TerminalOutput[] = []
    for (const [id, instance] of this.instances) {
      if (instance.cwd === worktreePath) {
        results.push({ ptyId: id, output: instance.buffer.read() })
      }
    }
    return results
  }

  setScrollbackBufferMaxLength(maxLength: number): void {
    for (const instance of this.instances.values()) {
      instance.buffer.setMaxLength(maxLength)
    }
  }

  // ── External event subscriptions (mobile companion) ────────────────────────

  /** Subscribe to data events for a specific PTY. Returns an unsubscribe function. */
  onData(ptyId: string, callback: (ptyId: string, data: string) => void): () => void {
    if (!this.dataListeners.has(ptyId)) this.dataListeners.set(ptyId, new Set())
    this.dataListeners.get(ptyId)!.add(callback)
    return () => { this.dataListeners.get(ptyId)?.delete(callback) }
  }

  /** Subscribe to exit events for a specific PTY. Returns an unsubscribe function. */
  onExit(ptyId: string, callback: (ptyId: string, exitCode: number) => void): () => void {
    if (!this.exitListeners.has(ptyId)) this.exitListeners.set(ptyId, new Set())
    this.exitListeners.get(ptyId)!.add(callback)
    return () => { this.exitListeners.get(ptyId)?.delete(callback) }
  }

  /** List all active PTY instances, optionally filtered by worktree path. */
  listInstances(worktreePath?: string): PtyInstanceInfo[] {
    const results: PtyInstanceInfo[] = []
    for (const [id, instance] of this.instances) {
      if (!worktreePath || instance.cwd === worktreePath) {
        const terminalId = this.bigTerminalByPty.get(id)
        const metadata = terminalId ? this.bigTerminalMetadataById.get(terminalId) : undefined
        results.push({
          ptyId: id,
          cwd: instance.cwd,
          terminalId,
          title: metadata?.label,
          label: metadata?.label,
          agentId: metadata?.agentId,
          worktreeId: metadata?.worktreeId,
          totalRunDurationMs: metadata?.totalRunDurationMs,
        })
      }
    }
    return results
  }

  listInstancesWithPid(): Array<{ ptyId: string; cwd: string; pid: number | null }> {
    const results: Array<{ ptyId: string; cwd: string; pid: number | null }> = []
    for (const [id, instance] of this.instances) {
      results.push({ ptyId: id, cwd: instance.cwd, pid: instance.process.pid ?? null })
    }
    return results
  }

  // ── Big Terminal scrollback persistence ────────────────────────────────────

  private writeScrollbackFile(terminalId: string, data: string): void {
    try {
      mkdirSync(scrollbackDir(), { recursive: true })
      writeFileSync(scrollbackPath(terminalId), data, { encoding: 'utf8', mode: 0o600 })
    } catch (err) {
      // Non-fatal: scrollback is a best-effort restore aid
      console.warn('[pty] Failed to persist scrollback for', terminalId, err)
    }
  }

  registerBigTerminal(ptyId: string, terminalId: string): void {
    if (!this.instances.has(ptyId)) return
    this.bigTerminalByPty.set(ptyId, terminalId)
  }

  setBigTerminalMetadata(metadata: BigTerminalMetadata): void {
    // Preserve accumulated run duration across label/agent re-syncs from the
    // renderer (which doesn't track the run timer and omits totalRunDurationMs).
    const existing = this.bigTerminalMetadataById.get(metadata.terminalId)
    this.bigTerminalMetadataById.set(metadata.terminalId, {
      ...metadata,
      totalRunDurationMs: metadata.totalRunDurationMs ?? existing?.totalRunDurationMs,
    })
  }

  removeBigTerminalMetadata(terminalId: string): void {
    this.bigTerminalMetadataById.delete(terminalId)
  }

  addBigTerminalRunDuration(terminalId: string, deltaMs: number): void {
    if (deltaMs <= 0) return
    const existing = this.bigTerminalMetadataById.get(terminalId)
    if (!existing) return
    existing.totalRunDurationMs = (existing.totalRunDurationMs ?? 0) + deltaMs
  }

  readScrollback(terminalId: string): string {
    try {
      return readFileSync(scrollbackPath(terminalId), { encoding: 'utf8' })
    } catch {
      return ''
    }
  }

  deleteScrollback(terminalId: string): void {
    try {
      unlinkSync(scrollbackPath(terminalId))
    } catch {
      // File may not exist - ignore
    }
  }

  dumpAllScrollbacks(): void {
    for (const [ptyId, terminalId] of this.bigTerminalByPty) {
      const instance = this.instances.get(ptyId)
      if (instance) this.writeScrollbackFile(terminalId, instance.buffer.read())
    }
  }

  /** Run a command synchronously and return when it exits. Used for archive scripts. */
  async runScript(cwd: string, command: string, timeoutMs = 30_000): Promise<{ exitCode: number }> {
    const nodePty = await import('node-pty')
    const shell = this.resolveShell()
    const safeCwd = existsSync(cwd) ? cwd : homedir()

    return new Promise((resolve, reject) => {
      let ptyProcess: import('node-pty').IPty
      try {
        ptyProcess = nodePty.spawn(shell, ['-l', '-c', command], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: safeCwd,
          env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        reject(new Error(
          `Failed to spawn terminal (shell: ${shell}, cwd: ${safeCwd}): ${msg}. ` +
          `Check that the shell binary exists and is executable.`
        ))
        return
      }

      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          ptyProcess.kill()
          resolve({ exitCode: -1 })
        }
      }, timeoutMs)

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve({ exitCode })
        }
      })
    })
  }
}

// ── Service creation with daemon fallback ────────────────────────────────────

import { PtyDaemonAdapter } from './ptyDaemon'

/**
 * Create the PTY service. Uses PtyDaemonAdapter by default, which spawns
 * a standalone daemon process so terminals survive app restarts.
 * Falls back to in-process PtyService if the daemon fails to initialize.
 */
function createPtyService(): IPtyService & { reattach?: (sessionId: string) => Promise<import('./ptyDaemon').ReattachResult | null>; listSessions?: () => Promise<import('./ptyDaemon').SessionInfo[]>; disconnectFromDaemon?: () => void; ensureDaemon?: () => Promise<void> } {
  try {
    const adapter = new PtyDaemonAdapter()
    console.log('[pty] Using daemon adapter')
    return adapter
  } catch (err) {
    console.warn('[pty] Failed to create daemon adapter, falling back to in-process:', err)
    return new PtyService()
  }
}

export const ptyService = createPtyService()

// Flush all big-terminal scrollbacks on graceful app quit so next launch can replay.
app.on('before-quit', () => {
  ptyService.dumpAllScrollbacks()
  // Disconnect from daemon (don't kill it - it should outlive us)
  if ('disconnectFromDaemon' in ptyService && typeof ptyService.disconnectFromDaemon === 'function') {
    ptyService.disconnectFromDaemon()
  }
})
