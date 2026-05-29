/**
 * PtyDaemonAdapter - implements IPtyService by proxying to the daemon.
 *
 * This replaces the in-process PtyService when the daemon is available.
 * The renderer is completely unaware of the daemon - it uses the same
 * IPC protocol (pty:spawn, pty:write, pty:data, etc.).
 */
import { BrowserWindow, app } from 'electron'
import { existsSync, lstatSync, accessSync, constants as fsConstants, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { fork, execFileSync } from 'child_process'
import { mainSettings } from '../../ipc'
import { getHookServerPort, getHookServerToken } from '../agentHookServer'
import { DaemonClient } from './client'
import { isDaemonRunning, removeSocketFile } from './lifecycle'
import { SOCKET_PATH } from './protocol'
import { RingBuffer } from './sessionHost'
import type { IPtyService, TerminalOutput } from '../pty'
import type { ReattachResult, SessionInfo } from './types'
import { getTerminalScrollbackBufferMaxLength } from '../../../shared/terminal'

// ── Scrollback helpers (same as PtyService) ──────────────────────────────────

function scrollbackDir(): string {
  return join(homedir(), 'Braid', 'bigTerminals')
}

function scrollbackPath(terminalId: string): string {
  if (!/^bt-\d+-\d+$/.test(terminalId)) {
    throw new Error(`Invalid terminal id: ${terminalId}`)
  }
  return join(scrollbackDir(), `${terminalId}.scrollback`)
}

// ── Shell resolution (same as PtyService) ────────────────────────────────────

function isExecutable(path: string): boolean {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      if (!existsSync(path)) return false
    }
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveShell(): string {
  const configured = mainSettings.terminalShell
  if (configured && isExecutable(configured)) return configured
  if (process.env.SHELL && isExecutable(process.env.SHELL)) return process.env.SHELL
  try {
    const result = execFileSync('dscl', ['.', '-read', `/Users/${process.env.USER ?? 'root'}`, 'UserShell'], { encoding: 'utf8', timeout: 2000 })
    const match = result.match(/UserShell:\s*(\S+)/)
    if (match && isExecutable(match[1])) return match[1]
  } catch { /* ignore */ }
  return '/bin/zsh'
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export class PtyDaemonAdapter implements IPtyService {
  private client: DaemonClient
  /** Mapping daemon sessionId to the cwd it was spawned with. */
  private cwdBySession = new Map<string, string>()
  /** Mapping daemon sessionId to big-terminal id (for scrollback). */
  private bigTerminalBySession = new Map<string, string>()
  /** Local RingBuffer mirror per session - keeps readTerminalOutput() working synchronously. */
  private buffers = new Map<string, RingBuffer>()
  /** External data listeners (e.g. mobile companion server). */
  private dataListeners = new Map<string, Set<(ptyId: string, data: string) => void>>()
  /** External exit listeners (e.g. mobile companion server). */
  private exitListeners = new Map<string, Set<(ptyId: string, exitCode: number) => void>>()
  /** Serializes concurrent ensureDaemon() calls to prevent spawning duplicate daemons. */
  private pendingEnsure: Promise<void> | null = null

  constructor() {
    this.client = new DaemonClient()

    // Forward daemon data/exit events to the renderer via IPC,
    // and mirror output into local RingBuffers for readTerminalOutput().
    this.client.on('data', (sessionId, data) => {
      this.buffers.get(sessionId)?.push(data)
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:data', sessionId, data)
      }
      for (const cb of this.dataListeners.get(sessionId) ?? []) cb(sessionId, data)
    })

    this.client.on('exit', (sessionId, exitCode) => {
      // Persist scrollback for big terminals before cleaning up (matches legacy behavior)
      const terminalId = this.bigTerminalBySession.get(sessionId)
      const buffer = this.buffers.get(sessionId)
      if (terminalId && buffer) {
        this.writeScrollbackFile(terminalId, buffer.read())
      }
      this.cwdBySession.delete(sessionId)
      this.bigTerminalBySession.delete(sessionId)
      this.buffers.delete(sessionId)
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:exit', sessionId, exitCode)
      }
      for (const cb of this.exitListeners.get(sessionId) ?? []) cb(sessionId, exitCode)
      this.dataListeners.delete(sessionId)
      this.exitListeners.delete(sessionId)
    })
  }

  private getWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows()
    return windows[0] ?? null
  }

  // ── Daemon lifecycle ───────────────────────────────────────────────────

  /** Ensure the daemon is running and the client is connected. */
  async ensureDaemon(): Promise<void> {
    if (this.client.connected) return

    // Serialize concurrent calls so we don't spawn duplicate daemons
    if (this.pendingEnsure) return this.pendingEnsure

    this.pendingEnsure = this.doEnsureDaemon().finally(() => {
      this.pendingEnsure = null
    })
    return this.pendingEnsure
  }

  private async doEnsureDaemon(): Promise<void> {
    if (this.client.connected) return

    const pid = isDaemonRunning()
    if (!pid) {
      await this.spawnDaemon()
    }

    try {
      await this.client.connect()
    } catch {
      // Socket may be stale, try spawning a fresh daemon
      removeSocketFile()
      await this.spawnDaemon()
      await this.client.connect()
    }
  }

  private async spawnDaemon(): Promise<void> {
    // Find the daemon entry point - adjacent to this file in the build output
    const daemonPath = join(__dirname, 'daemonMain.js')

    const child = fork(daemonPath, [], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        // Pass through the shell so the daemon uses the same shell
        SHELL: resolveShell(),
      },
    })
    child.unref()

    // Wait for the socket to appear (daemon needs a moment to start)
    await this.waitForSocket(5_000)
  }

  private waitForSocket(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const start = Date.now()
      const check = (): void => {
        if (existsSync(SOCKET_PATH)) {
          resolve()
          return
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Timed out waiting for daemon socket'))
          return
        }
        setTimeout(check, 100)
      }
      check()
    })
  }

  /** Disconnect from the daemon (don't kill it). Called on app quit. */
  disconnectFromDaemon(): void {
    this.client.disconnect()
  }

  // ── IPtyService implementation ─────────────────────────────────────────

  async spawn(cwd: string, envOverrides?: Record<string, string>): Promise<string> {
    await this.ensureDaemon()

    const shell = resolveShell()
    const safeCwd = existsSync(cwd) ? cwd : homedir()

    // Use the renderer's stable terminal ID as the daemon session key when provided.
    // This makes reattach work: the renderer calls reattach(terminalId) and the daemon
    // can find the session because it was keyed by the same ID.
    const sessionId = envOverrides?.BRAID_TERMINAL_ID ?? `pty-d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const hookPort = getHookServerPort()
    const hookToken = getHookServerToken()
    const env: Record<string, string> = {
      TERM: 'xterm-256color',
      BRAID_TERMINAL: '1',
      ...(hookPort > 0 ? { BRAID_HOOK_PORT: String(hookPort), BRAID_HOOK_TOKEN: hookToken } : {}),
      ...envOverrides,
    }

    try {
      await this.client.spawn(
        sessionId,
        safeCwd,
        80,
        24,
        shell,
        env,
        getTerminalScrollbackBufferMaxLength(mainSettings.terminalScrollback),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Terminal spawn failed (shell: ${shell}, cwd: ${safeCwd}): ${msg}`, { cause: err })
    }
    this.cwdBySession.set(sessionId, safeCwd)
    this.buffers.set(sessionId, new RingBuffer(getTerminalScrollbackBufferMaxLength(mainSettings.terminalScrollback)))
    return sessionId
  }

  write(id: string, data: string): void {
    this.client.write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.client.resize(id, cols, rows)
  }

  kill(id: string): void {
    // Persist scrollback for big terminals before killing (onExit may not fire reliably)
    const terminalId = this.bigTerminalBySession.get(id)
    const buffer = this.buffers.get(id)
    if (terminalId && buffer) {
      this.writeScrollbackFile(terminalId, buffer.read())
    }
    this.client.kill(id).catch(() => {
      // Session may already be dead
    })
    this.cwdBySession.delete(id)
    this.bigTerminalBySession.delete(id)
    this.buffers.delete(id)
  }

  killAll(): void {
    // Persist scrollback for all big terminals before killing
    for (const [sessionId, terminalId] of this.bigTerminalBySession) {
      const buffer = this.buffers.get(sessionId)
      if (buffer) this.writeScrollbackFile(terminalId, buffer.read())
    }
    for (const sessionId of this.cwdBySession.keys()) {
      this.client.kill(sessionId).catch(() => {})
    }
    this.cwdBySession.clear()
    this.bigTerminalBySession.clear()
    this.buffers.clear()
  }

  readTerminalOutput(worktreePath: string): TerminalOutput[] {
    const results: TerminalOutput[] = []
    for (const [sessionId, cwd] of this.cwdBySession) {
      if (cwd === worktreePath) {
        const buffer = this.buffers.get(sessionId)
        results.push({ ptyId: sessionId, output: buffer?.read() ?? '' })
      }
    }
    return results
  }

  setScrollbackBufferMaxLength(maxLength: number): void {
    for (const buffer of this.buffers.values()) {
      buffer.setMaxLength(maxLength)
    }

    if (!this.client.connected && !isDaemonRunning()) return
    this.ensureDaemon()
      .then(() => this.client.setBufferMaxLength(maxLength))
      .catch(() => {
        // Best effort. New sessions still receive the current limit on spawn.
      })
  }

  // ── Big Terminal scrollback persistence ────────────────────────────────

  registerBigTerminal(ptyId: string, terminalId: string): void {
    this.bigTerminalBySession.set(ptyId, terminalId)
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
      // File may not exist
    }
  }

  dumpAllScrollbacks(): void {
    for (const [sessionId, terminalId] of this.bigTerminalBySession) {
      const buffer = this.buffers.get(sessionId)
      if (buffer) this.writeScrollbackFile(terminalId, buffer.read())
    }
  }

  onData(ptyId: string, callback: (ptyId: string, data: string) => void): () => void {
    if (!this.dataListeners.has(ptyId)) this.dataListeners.set(ptyId, new Set())
    this.dataListeners.get(ptyId)!.add(callback)
    return () => { this.dataListeners.get(ptyId)?.delete(callback) }
  }

  onExit(ptyId: string, callback: (ptyId: string, exitCode: number) => void): () => void {
    if (!this.exitListeners.has(ptyId)) this.exitListeners.set(ptyId, new Set())
    this.exitListeners.get(ptyId)!.add(callback)
    return () => { this.exitListeners.get(ptyId)?.delete(callback) }
  }

  listInstances(worktreePath?: string): Array<{ ptyId: string; cwd: string }> {
    const results: Array<{ ptyId: string; cwd: string }> = []
    for (const [id, cwd] of this.cwdBySession) {
      if (!worktreePath || cwd === worktreePath) {
        results.push({ ptyId: id, cwd })
      }
    }
    return results
  }

  listInstancesWithPid(): Array<{ ptyId: string; cwd: string; pid: number | null }> {
    const results: Array<{ ptyId: string; cwd: string; pid: number | null }> = []
    for (const [id, cwd] of this.cwdBySession) {
      results.push({ ptyId: id, cwd, pid: null })
    }
    return results
  }

  private writeScrollbackFile(terminalId: string, data: string): void {
    try {
      mkdirSync(scrollbackDir(), { recursive: true })
      writeFileSync(scrollbackPath(terminalId), data, { encoding: 'utf8', mode: 0o600 })
    } catch (err) {
      console.warn('[pty-daemon] Failed to persist scrollback for', terminalId, err)
    }
  }

  /** Run a command non-interactively. This stays in-process (ephemeral, no persistence needed). */
  async runScript(cwd: string, command: string, timeoutMs = 30_000): Promise<{ exitCode: number }> {
    // runScript is ephemeral - use in-process node-pty directly
    const nodePty = await import('node-pty')
    const shell = resolveShell()
    const safeCwd = existsSync(cwd) ? cwd : homedir()

    return new Promise((resolve, reject) => {
      let ptyProcess: import('node-pty').IPty
      try {
        ptyProcess = nodePty.spawn(shell, ['-l', '-c', command], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: safeCwd,
          env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        reject(new Error(`Failed to spawn script (shell: ${shell}, cwd: ${safeCwd}): ${msg}`))
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

  // ── Daemon-specific operations ─────────────────────────────────────────

  /** Reattach to an existing daemon session. Returns snapshot or null. */
  async reattach(sessionId: string): Promise<ReattachResult | null> {
    try {
      await this.ensureDaemon()
      const result = await this.client.attach(sessionId)
      // Initialize local buffer with snapshot so readTerminalOutput works
      const buffer = new RingBuffer(getTerminalScrollbackBufferMaxLength(mainSettings.terminalScrollback))
      buffer.push(result.snapshot)
      this.buffers.set(sessionId, buffer)
      // Populate cwdBySession from the daemon's session list if we don't have it
      if (!this.cwdBySession.has(sessionId)) {
        try {
          const sessions = await this.client.list()
          const info = sessions.find((s) => s.sessionId === sessionId)
          if (info) this.cwdBySession.set(sessionId, info.cwd)
        } catch {
          // Non-fatal - readTerminalOutput() just won't match this session
        }
      }
      return { sessionId, snapshot: result.snapshot }
    } catch {
      return null
    }
  }

  /** List all active sessions in the daemon. */
  async listSessions(): Promise<SessionInfo[]> {
    try {
      await this.ensureDaemon()
      return await this.client.list()
    } catch {
      return []
    }
  }
}
