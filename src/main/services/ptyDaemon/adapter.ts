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
import { getTerminalScrollbackBufferMaxLength } from '../../../shared/terminal'

export class PtyDaemonAdapter extends DaemonAdapterCore {
  // ── Daemon-specific operations ─────────────────────────────────────────

  /** Reattach to an existing daemon session. Returns snapshot or null. */
  async reattach(sessionId: string): Promise<ReattachResult | null> {
    try {
      await this.ensureDaemon()
      const result = await this.client.attach(sessionId)
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
      return { sessionId, snapshot: result.snapshot, coldRestored: result.coldRestored === true, ...(foregroundAtLoss ? { foregroundAtLoss } : {}) }
    } catch {
      return null
    }
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
