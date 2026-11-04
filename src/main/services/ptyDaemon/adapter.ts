/**
 * PtyDaemonAdapter - implements IPtyService by proxying to the daemon.
 *
 * This replaces the in-process PtyService when the daemon is available.
 * The renderer is completely unaware of the daemon - it uses the same
 * IPC protocol (pty:spawn, pty:write, pty:data, etc.).
 *
 * The IPtyService basics are in DaemonAdapterCore (adapterCore.ts); this
 * file adds the operations only the daemon has.
 */
import { mainSettings } from '../../ipc'
import { DaemonAdapterCore } from './adapterCore'
import { isReapableTerminalId, selectOrphanedSessions } from './orphan'
import { RingBuffer } from './ringBuffer'
import type { OrphanedTerminal } from '../pty'
import type { ReattachResult, SessionInfo } from './types'
import type { HeadlessSnapshot, TerminalColors } from './protocol'
import { getTerminalScrollbackBufferMaxLength } from '../../../shared/terminal'

export class PtyDaemonAdapter extends DaemonAdapterCore {
  // ── Daemon-specific operations ─────────────────────────────────────────

  /**
   * Reattach to an existing daemon session. Returns the raw ring-buffer
   * snapshot (legacy path) or null. `snapshot: false` (background warm-up):
   * attach for status and the local mirror only - the session starts hidden
   * and no snapshot goes to the renderer.
   */
  async reattach(sessionId: string, opts: { snapshot?: boolean } = {}): Promise<ReattachResult | null> {
    try {
      await this.ensureDaemon()
      if (opts.snapshot === false) this.delivery.setVisible(sessionId, false)
      // The renderer's xterm for this session starts empty: a reveal must snapshot.
      this.delivery.markStale(sessionId)
      // Shown: the reveal's snapshot follows, and the daemon answers everything until it is taken.
      const visible = this.delivery.isDelivering(sessionId)
      const result = await this.client.attach(sessionId, this.delivery.isOffloading() ? { visible, snapshotFollows: visible } : {})
      this.delivery.clearShowPoint(sessionId)
      if (visible && this.delivery.isOffloading()) this.announcedSnapshots.add(sessionId)
      // Seed a local buffer from the snapshot so readTerminalOutput works. Don't
      // clobber an existing buffer: the desktop and mobile can each attach the
      // same session, and replacing a live buffer would drop the scrollback the
      // other side has already accumulated.
      if (!this.buffers.has(sessionId)) {
        const buffer = new RingBuffer(getTerminalScrollbackBufferMaxLength(mainSettings.terminalScrollback))
        buffer.push(result.snapshot)
        this.buffers.set(sessionId, buffer)
      }
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
      const foregroundAtLoss = result.foregroundAtLoss === 'shell' || result.foregroundAtLoss === 'command' ? result.foregroundAtLoss : undefined
      const snapshot = opts.snapshot === false ? '' : result.snapshot
      return { sessionId, snapshot, coldRestored: result.coldRestored === true, ...(foregroundAtLoss ? { foregroundAtLoss } : {}) }
    } catch {
      return null
    }
  }

  // ── Hidden-terminal offload (daemon with headless-snapshot + status-events) ─

  /**
   * Snapshot to show a terminal again. Live output is held until the renderer
   * confirms with snapshotApplied(). `upToDate` when the renderer's xterm
   * missed nothing; null in legacy mode or when the session is gone.
   */
  async headlessSnapshot(sessionId: string): Promise<(HeadlessSnapshot & { upToDate?: false }) | { upToDate: true } | null> {
    if (!this.delivery.isOffloading()) return null
    // A snapshot announced to the daemon is taken even when nothing was missed,
    // or the daemon keeps answering until its handoff times out.
    const announced = this.announcedSnapshots.delete(sessionId)
    if (!this.delivery.isStale(sessionId) && !announced) return { upToDate: true }
    this.delivery.beginHold(sessionId)
    try {
      const snap = await this.client.headlessSnapshot(sessionId)
      if (!snap) this.delivery.releaseHold(sessionId)
      return snap
    } catch {
      this.delivery.releaseHold(sessionId)
      return null
    }
  }

  /** The renderer wrote the snapshot: send live output newer than `seq`. */
  snapshotApplied(sessionId: string, seq: number): void {
    this.delivery.endHold(sessionId, seq)
  }

  /** The renderer's terminal colours: hidden terminals answer colour queries with them. */
  setTerminalColors(colors: TerminalColors): void {
    this.terminalColors = colors
    if (this.client.connected) this.client.setColors(colors)
  }

  /** Keep delivering a hidden terminal while the renderer still needs its output. */
  setDeliveryInterest(sessionId: string, interested: boolean): void {
    this.delivery.setInterest(sessionId, interested)
  }

  /** Any session ended. `selfExit`: the shell exited on its own (user typed `exit`). */
  onSessionEnded(cb: (sessionId: string, selfExit: boolean) => void): () => void {
    this.sessionEndedListeners.add(cb)
    return () => { this.sessionEndedListeners.delete(cb) }
  }

  /** One-shot claim of a cold-restored session (see SessionHost.consumeColdRestore). */
  async consumeColdRestore(sessionId: string): Promise<boolean> {
    try {
      await this.ensureDaemon()
      return await this.client.consumeColdRestore(sessionId)
    } catch {
      return false
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

  /** Big-terminal daemon sessions the desktop no longer tracks (see selectOrphanedSessions). */
  async listOrphanedBigTerminals(knownTerminalIds: string[]): Promise<OrphanedTerminal[]> {
    return selectOrphanedSessions(await this.listSessions(), knownTerminalIds)
  }

  /**
   * Reap the given orphaned big terminals in the daemon. For big terminals the
   * daemon sessionId IS the terminalId, so we can kill directly even when this
   * process never reattached them (so they aren't in the local maps). Returns
   * the number actually killed.
   */
  async killOrphanedBigTerminals(terminalIds: string[]): Promise<number> {
    await this.ensureDaemon()
    // Defense in depth: re-check attachment immediately before killing so a stale
    // request (a session that became live between scan and confirm) can never
    // reap a terminal someone is now viewing. Only sessions with zero attached
    // clients are eligible.
    const attachedById = new Map((await this.listSessions()).map((s) => [s.sessionId, s.attachedClients]))
    let killed = 0
    for (const terminalId of terminalIds) {
      if (!isReapableTerminalId(terminalId)) continue
      if ((attachedById.get(terminalId) ?? 0) > 0) continue
      try {
        await this.client.kill(terminalId)
        killed++
      } catch {
        // Session may already be dead - still clear any local state below.
      }
      this.cwdBySession.delete(terminalId)
      this.bigTerminalBySession.delete(terminalId)
      this.metadata.delete(terminalId)
      this.buffers.delete(terminalId)
      this.deleteScrollback(terminalId)
    }
    return killed
  }
}
