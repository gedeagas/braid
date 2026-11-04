/**
 * Core of PtyDaemonAdapter: the IPtyService operations, proxied to the daemon,
 * plus the local state main keeps per session (cwd, ring buffer mirror,
 * metadata) and batched delivery of output to the renderer.
 * Daemon-specific operations (reattach, cold restore, orphans) live in
 * adapter.ts.
 */
import { existsSync } from 'fs'
import { homedir } from 'os'
import { mainSettings } from '../../ipc'
import { resolveShellPath } from '../../lib/shell'
import { getHookServerPort, getHookServerToken } from '../agentHookServer'
import { getBrowserSettings, pathWithBridge } from '../browser'
import { DaemonClient } from './client'
import { isDaemonRunning, RespawnThrottle } from './lifecycle'
import { connectToDaemon } from './daemonLauncher'
import { PtyListeners } from './ptyListeners'
import { BigTerminalMetadataStore } from './bigTerminalMetadata'
import { RingBuffer } from './ringBuffer'
import { deleteScrollbackFile, readScrollbackFile, writeScrollbackFile } from './scrollbackFiles'
import { runScriptInPty } from './runScript'
import { createRendererDelivery, sendToRenderer } from './delivery/rendererSink'
import type { DeliveringInfo, OffloadingDelivery } from './delivery/offloadDelivery'
import type { BigTerminalMetadata, IPtyService, PtyInstanceInfo, TerminalOutput } from '../pty'
import { getTerminalScrollbackBufferMaxLength } from '../../../shared/terminal'

// ── Shell resolution ──────────────────────────────────────────────────────────

export function resolveShell(): string {
  return resolveShellPath(mainSettings.terminalShell)
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export abstract class DaemonAdapterCore implements IPtyService {
  protected client: DaemonClient
  /** Mapping daemon sessionId to the cwd it was spawned with. */
  protected cwdBySession = new Map<string, string>()
  /** Mapping daemon sessionId to big-terminal id (for scrollback). */
  protected bigTerminalBySession = new Map<string, string>()
  protected metadata = new BigTerminalMetadataStore((id, md) => {
    this.ensureDaemon()
      .then(() => this.client.setMetadata(id, md))
      .catch(() => { /* best effort: the renderer re-syncs labels on worktree hydration */ })
  })
  /** Local RingBuffer mirror per session - keeps readTerminalOutput() working synchronously. */
  protected buffers = new Map<string, RingBuffer>()
  /** External data/exit/resize listeners (mobile companion server). */
  protected listeners = new PtyListeners()
  /** Last known dimensions per session (the daemon doesn't echo size back, so we track the requested dims). */
  protected sizeBySession = new Map<string, { cols: number; rows: number }>()
  /** Serializes concurrent ensureDaemon() calls to prevent spawning duplicate daemons. */
  private pendingEnsure: Promise<void> | null = null
  /** Notified when any daemon session ends (see onSessionEnded). */
  protected sessionEndedListeners = new Set<(sessionId: string, selfExit: boolean) => void>()
  /** Stops respawning a daemon that keeps dying on start. */
  private spawnThrottle = new RespawnThrottle()
  /** Last colours the renderer pushed, re-sent to a (re)connected daemon. */
  protected terminalColors: import('./protocol').TerminalColors | null = null
  /** Batches output to the renderer with flow control (see delivery/). */
  protected delivery: OffloadingDelivery

  constructor() {
    this.client = new DaemonClient()
    this.delivery = createRendererDelivery({
      pause: (id) => this.client.pause(id),
      resume: (id) => this.client.resume(id),
    }, (id, delivering, info) => {
      // The daemon's headless terminal answers the terminal queries in the
      // output no renderer receives. Only for sessions this process is
      // attached to (buffers = spawned or reattached here).
      if (!this.buffers.has(id)) {
        this.delivery.clearShowPoint(id)
        return
      }
      this.syncVisible(id, delivering, info)
    })

    // Mirror output into local RingBuffers for readTerminalOutput(), hand every
    // byte to external listeners (mobile companion), and queue it for the
    // renderer, which receives it in batches.
    this.client.on('data', (sessionId, data, seq) => {
      this.buffers.get(sessionId)?.push(data)
      this.listeners.emitData(sessionId, data)
      this.delivery.push(sessionId, data, seq)
    })

    // Producer pause only where the daemon supports it (an older daemon kept
    // across an app update does not).
    this.client.on('features', () => {
      this.delivery.setProducerPause(this.client.hasFeature('flow-control'))
      this.delivery.setOffload(this.offloadCapable())
      if (this.terminalColors) this.client.setColors(this.terminalColors)
      // A (re)connected daemon must know which sessions we deliver.
      if (this.delivery.isOffloading()) {
        for (const id of this.buffers.keys()) {
          this.syncVisible(id, this.delivery.isDelivering(id), this.delivery.restartShow(id))
        }
      }
      sendToRenderer('pty:featuresChanged', [...this.client.getFeatures()])
    })
    // Agent status detected by the daemon, for the renderer's stores.
    this.client.on('status', (event) => {
      sendToRenderer('pty:agentStatus', { terminalId: event.sessionId, kind: event.kind, status: event.status, replayed: event.replayed })
    })
    // The daemon resumes the sessions a disconnected client paused.
    this.client.on('disconnected', () => this.delivery.forgetProducerPauses())

    this.client.on('exit', (sessionId, exitCode, selfExit) => {
      for (const cb of this.sessionEndedListeners) {
        try { cb(sessionId, selfExit) } catch { /* listeners must not break exit handling */ }
      }
      // Persist scrollback for big terminals before cleaning up (matches legacy behavior)
      const terminalId = this.bigTerminalBySession.get(sessionId)
      const buffer = this.buffers.get(sessionId)
      if (terminalId && buffer) {
        this.writeScrollbackFile(terminalId, buffer.read())
      }
      this.cwdBySession.delete(sessionId)
      this.bigTerminalBySession.delete(sessionId)
      this.buffers.delete(sessionId)
      // Trailing output goes out before the exit notice.
      this.delivery.drain(sessionId)
      sendToRenderer('pty:exit', sessionId, exitCode)
      this.listeners.emitExit(sessionId, exitCode)
      this.listeners.clear(sessionId)
      this.sizeBySession.delete(sessionId)
    })
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
    await connectToDaemon(this.client, this.spawnThrottle, resolveShell())

    // Rebuild the local big-terminal metadata map from the daemon. After an app
    // restart the daemon keeps PTYs (and their persisted labels) alive, but this
    // process starts with an empty map - so listInstances() would otherwise lose
    // the real terminal names until the renderer re-syncs them.
    await this.hydrateMetadataFromDaemon()
  }

  /** Pull persisted big-terminal metadata from the daemon into the local maps. */
  private async hydrateMetadataFromDaemon(): Promise<void> {
    try {
      for (const session of this.metadata.hydrate(await this.client.list())) {
        this.bigTerminalBySession.set(session.sessionId, session.sessionId)
        // Seed the cwd map too. listInstances() (which backs the mobile
        // terminal.list) iterates cwdBySession, so without this a cold-started
        // big terminal stays invisible until the desktop renderer reattaches it
        // by opening that worktree's panel.
        this.cwdBySession.set(session.sessionId, session.cwd)
      }
    } catch {
      // Best effort - labels just fall back to the terminal id.
    }
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
      // braid-browser CLI for agents running in this terminal.
      ...(getBrowserSettings().exposeToTerminalAgents ? { PATH: pathWithBridge(process.env.PATH) } : {}),
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
        // A new terminal is on screen from the start (renderer reports otherwise).
        { scrollback: mainSettings.terminalScrollback, visible: this.delivery.isDelivering(sessionId) },
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
    this.delivery.noteInput(id)
    this.client.write(id, data)
  }

  /** Renderer shows (or hid) this terminal: visible ones are served first. */
  setVisible(id: string, visible: boolean): void {
    this.delivery.setVisible(id, visible)
  }

  /** The daemon keeps screen state and agent status: hidden terminals get no output. */
  /** Shows that announced a snapshot to the daemon, until it is requested. */
  protected announcedSnapshots = new Set<string>()

  /** Tell the daemon whether we deliver `id`; on show, give delivery its show point. */
  protected syncVisible(id: string, delivering: boolean, info: DeliveringInfo): void {
    const show = 'token' in info ? info : null
    if (show?.snapshotFollows) this.announcedSnapshots.add(id)
    else this.announcedSnapshots.delete(id)
    const opts = show
      ? { snapshotFollows: show.snapshotFollows }
      : 'deliveredThrough' in info && info.deliveredThrough !== undefined ? { deliveredThrough: info.deliveredThrough } : {}
    this.client.setVisible(id, delivering, opts).then((reply) => {
      if (!show) return
      if (reply) this.delivery.setShowPoint(id, reply.seq, show.token)
      else this.delivery.clearShowPoint(id)
    }, () => { if (show) this.delivery.clearShowPoint(id) })
  }

  protected offloadCapable(): boolean {
    return this.client.hasFeature('headless-snapshot') && this.client.hasFeature('status-events')
  }

  // ── Output flow control (renderer side) ────────────────────────────────

  /** Renderer's running total of characters it has processed for `id`. */
  ackData(id: string, processedTotal: number): void {
    this.delivery.ack(id, processedTotal)
  }

  /** Renderer reloaded or crashed: reset counts and resume every session. */
  resetDelivery(): void {
    this.delivery.reset()
  }

  /** The renderer's pty:data listener is up: output may be sent (and counted). */
  setRendererReady(): void {
    this.delivery.setRendererReady()
  }

  /** Features the connected daemon reported (empty for an older daemon). */
  async getFeatures(): Promise<string[]> {
    try {
      await this.ensureDaemon()
    } catch {
      return []
    }
    return [...this.client.getFeatures()]
  }

  resize(id: string, cols: number, rows: number): void {
    this.client.resize(id, cols, rows)
    this.sizeBySession.set(id, { cols, rows })
    this.listeners.emitResize(id, cols, rows)
  }

  getSize(id: string): { cols: number; rows: number } | null {
    return this.sizeBySession.get(id) ?? null
  }

  onResize(ptyId: string, callback: (ptyId: string, cols: number, rows: number) => void): () => void {
    return this.listeners.onResize(ptyId, callback)
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
    this.delivery.remove(id)
    this.cwdBySession.delete(id)
    this.bigTerminalBySession.delete(id)
    this.buffers.delete(id)
  }

  killBigTerminal(terminalId: string): void {
    // Reverse-lookup the daemon sessionId from the terminalId so a tab close can
    // reap the persistent daemon session even when no renderer has it cached.
    // Without this, a closed big terminal survives in the daemon and resurfaces
    // (e.g. to the mobile app) as an orphaned session.
    for (const [sessionId, tid] of this.bigTerminalBySession) {
      if (tid === terminalId) {
        this.kill(sessionId)
        break
      }
    }
    this.metadata.delete(terminalId)
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
      .then(() => this.client.setBufferMaxLength(maxLength, mainSettings.terminalScrollback))
      .catch(() => {
        // Best effort. New sessions still receive the current limit on spawn.
      })
  }

  // ── Big Terminal scrollback persistence ────────────────────────────────

  registerBigTerminal(ptyId: string, terminalId: string): void {
    this.bigTerminalBySession.set(ptyId, terminalId)
  }

  setBigTerminalMetadata(metadata: BigTerminalMetadata): void {
    this.metadata.set(metadata)
  }

  removeBigTerminalMetadata(terminalId: string): void {
    this.metadata.delete(terminalId)
  }

  addBigTerminalRunDuration(terminalId: string, deltaMs: number): void {
    this.metadata.addRunDuration(terminalId, deltaMs)
  }

  readScrollback(terminalId: string): string {
    return readScrollbackFile(terminalId)
  }

  deleteScrollback(terminalId: string): void {
    deleteScrollbackFile(terminalId)
  }

  dumpAllScrollbacks(): void {
    for (const [sessionId, terminalId] of this.bigTerminalBySession) {
      const buffer = this.buffers.get(sessionId)
      if (buffer) this.writeScrollbackFile(terminalId, buffer.read())
    }
  }

  onData(ptyId: string, callback: (ptyId: string, data: string) => void): () => void {
    return this.listeners.onData(ptyId, callback)
  }

  onExit(ptyId: string, callback: (ptyId: string, exitCode: number) => void): () => void {
    return this.listeners.onExit(ptyId, callback)
  }

  listInstances(worktreePath?: string): PtyInstanceInfo[] {
    const results: PtyInstanceInfo[] = []
    for (const [id, cwd] of this.cwdBySession) {
      if (!worktreePath || cwd === worktreePath) {
        const terminalId = this.bigTerminalBySession.get(id)
        const metadata = terminalId ? this.metadata.get(terminalId) : undefined
        results.push({
          ptyId: id,
          cwd,
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
    for (const [id, cwd] of this.cwdBySession) {
      results.push({ ptyId: id, cwd, pid: null })
    }
    return results
  }

  protected writeScrollbackFile(terminalId: string, data: string): void {
    writeScrollbackFile(terminalId, data, '[pty-daemon]')
  }

  /** Run a command non-interactively. This stays in-process (ephemeral, no persistence needed). */
  async runScript(cwd: string, command: string, timeoutMs = 30_000): Promise<{ exitCode: number }> {
    return runScriptInPty(resolveShell(), cwd, command, timeoutMs)
  }
}
