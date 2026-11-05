import { app } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { mainSettings } from '../ipc'
import { resolveShellPath, resolveShellLaunchArgs } from '../lib/shell'
import { getHookServerPort, getHookServerToken } from './agentHookServer'
import { getBrowserSettings, pathWithBridge } from './browser'
import { getTerminalScrollbackBufferMaxLength } from '../../shared/terminal'
import { RingBuffer } from './ptyDaemon/ringBuffer'
import { PtyListeners } from './ptyDaemon/ptyListeners'
import { deleteScrollbackFile, readScrollbackFile, writeScrollbackFile } from './ptyDaemon/scrollbackFiles'
import { runScriptInPty } from './ptyDaemon/runScript'
import { PauseValve } from './ptyDaemon/delivery/pauseValve'
import { createRendererDelivery, sendToRenderer } from './ptyDaemon/delivery/rendererSink'

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
  /** Renderer's running total of output characters it has processed (flow control). */
  ackData?(ptyId: string, processedTotal: number): void
  /** Renderer reloaded or crashed: reset flow-control counts, resume every PTY. */
  resetDelivery?(): void
  /** The renderer's output listener is up: output may be sent (and counted). */
  setRendererReady?(): void
  /** The renderer shows (true) or hid (false) this terminal. */
  setVisible?(ptyId: string, visible: boolean): void
  /** Capabilities of the PTY backend (daemon `hello` features). Empty in-process. */
  getFeatures?(): Promise<string[]>
}

// ── Legacy in-process service ────────────────────────────────────────────────

class PtyService implements IPtyService {
  private instances = new Map<string, PtyInstance>()
  private counter = 0
  /** Mapping ptyId -> terminalId for big terminal PTYs (for scrollback persistence). */
  private bigTerminalByPty = new Map<string, string>()
  private bigTerminalMetadataById = new Map<string, BigTerminalMetadata>()
  /** External data/exit/resize listeners (mobile companion server). */
  private listeners = new PtyListeners()
  /** Flow control pauses the local node-pty directly, behind the same 10s valve as the daemon. */
  private valve = new PauseValve((id) => this.instances.get(id)?.process)
  private delivery = createRendererDelivery({
    pause: (id) => this.valve.pause(id, this),
    resume: (id) => this.valve.resume(id, this),
  })

  constructor() {
    this.delivery.setProducerPause(true)
  }

  private resolveShell(): string {
    return resolveShellPath(mainSettings.terminalShell)
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
      // braid-browser CLI for agents running in this terminal.
      ...(getBrowserSettings().exposeToTerminalAgents ? { PATH: pathWithBridge(process.env.PATH) } : {}),
      ...envOverrides,
    }

    let ptyProcess: import('node-pty').IPty
    try {
      ptyProcess = nodePty.spawn(shell, resolveShellLaunchArgs(shell).args, {
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
      // External listeners (mobile companion) get every byte; the renderer gets batches.
      this.listeners.emitData(id, data)
      this.delivery.push(id, data)
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      // Persist scrollback for big terminals before removing the instance
      const terminalId = this.bigTerminalByPty.get(id)
      if (terminalId) this.writeScrollbackFile(terminalId, buffer.read())
      // Trailing output goes out before the exit notice.
      this.delivery.drain(id)
      this.valve.forget(id)
      sendToRenderer('pty:exit', id, exitCode)
      // Notify external listeners (mobile companion)
      this.listeners.emitExit(id, exitCode)
      this.instances.delete(id)
      this.bigTerminalByPty.delete(id)
      this.listeners.clear(id)
    })

    this.instances.set(id, instance)
    return id
  }

  write(id: string, data: string): void {
    this.delivery.noteInput(id)
    this.instances.get(id)?.process.write(data)
  }

  setVisible(id: string, visible: boolean): void {
    this.delivery.setVisible(id, visible)
  }

  ackData(id: string, processedTotal: number): void {
    this.delivery.ack(id, processedTotal)
  }

  resetDelivery(): void {
    this.delivery.reset()
  }

  setRendererReady(): void {
    this.delivery.setRendererReady()
  }

  async getFeatures(): Promise<string[]> {
    return []
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (!instance) return
    instance.process.resize(cols, rows)
    instance.cols = cols
    instance.rows = rows
    this.listeners.emitResize(id, cols, rows)
  }

  getSize(id: string): { cols: number; rows: number } | null {
    const instance = this.instances.get(id)
    return instance ? { cols: instance.cols, rows: instance.rows } : null
  }

  onResize(ptyId: string, callback: (ptyId: string, cols: number, rows: number) => void): () => void {
    return this.listeners.onResize(ptyId, callback)
  }

  kill(id: string): void {
    // Persist scrollback for big terminals before killing (onExit may not fire reliably on kill)
    const terminalId = this.bigTerminalByPty.get(id)
    const instance = this.instances.get(id)
    if (terminalId && instance) this.writeScrollbackFile(terminalId, instance.buffer.read())
    instance?.process.kill()
    this.delivery.remove(id)
    this.valve.forget(id)
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
    return this.listeners.onData(ptyId, callback)
  }

  /** Subscribe to exit events for a specific PTY. Returns an unsubscribe function. */
  onExit(ptyId: string, callback: (ptyId: string, exitCode: number) => void): () => void {
    return this.listeners.onExit(ptyId, callback)
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
    writeScrollbackFile(terminalId, data, '[pty]')
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
    return readScrollbackFile(terminalId)
  }

  deleteScrollback(terminalId: string): void {
    deleteScrollbackFile(terminalId)
  }

  dumpAllScrollbacks(): void {
    for (const [ptyId, terminalId] of this.bigTerminalByPty) {
      const instance = this.instances.get(ptyId)
      if (instance) this.writeScrollbackFile(terminalId, instance.buffer.read())
    }
  }

  /** Run a command synchronously and return when it exits. Used for archive scripts. */
  async runScript(cwd: string, command: string, timeoutMs = 30_000): Promise<{ exitCode: number }> {
    return runScriptInPty(this.resolveShell(), cwd, command, timeoutMs)
  }
}

// ── Service creation with daemon fallback ────────────────────────────────────

import { PtyDaemonAdapter } from './ptyDaemon'

/**
 * Create the PTY service. Uses PtyDaemonAdapter by default, which spawns
 * a standalone daemon process so terminals survive app restarts.
 * Falls back to in-process PtyService if the daemon fails to initialize.
 */
/** A big-terminal daemon session the desktop no longer tracks as a tab. */
export interface OrphanedTerminal {
  terminalId: string
  cwd: string
  label?: string
  agentId?: string
}

type DaemonOnlyOps = Pick<PtyDaemonAdapter,
  | 'reattach' | 'consumeColdRestore' | 'onSessionEnded' | 'listSessions' | 'disconnectFromDaemon' | 'ensureDaemon'
  | 'listOrphanedBigTerminals' | 'killOrphanedBigTerminals' | 'headlessSnapshot' | 'snapshotApplied' | 'setDeliveryInterest'
  | 'setTerminalColors'>

function createPtyService(): IPtyService & Partial<DaemonOnlyOps> {
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
