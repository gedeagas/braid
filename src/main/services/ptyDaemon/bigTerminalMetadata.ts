// Big-terminal display metadata (label / agent / worktree / run time) kept in
// main and persisted on the daemon session so it survives an app restart.

import type { BigTerminalMetadata } from '../pty'
import type { DaemonSessionMetadata, SessionInfo } from './types'

export class BigTerminalMetadataStore {
  private byId = new Map<string, BigTerminalMetadata>()

  /** `persist` writes to the daemon (best effort, fire-and-forget). */
  constructor(private persist: (terminalId: string, metadata: DaemonSessionMetadata) => void) {}

  get(terminalId: string): BigTerminalMetadata | undefined {
    return this.byId.get(terminalId)
  }

  delete(terminalId: string): void {
    this.byId.delete(terminalId)
  }

  set(metadata: BigTerminalMetadata): void {
    // Preserve any accumulated run duration: the renderer syncs label/agent/
    // worktree but doesn't track the run timer, so it omits totalRunDurationMs.
    // A blind replace would reset the agent-time clock on every label sync.
    const existing = this.byId.get(metadata.terminalId)
    const merged: BigTerminalMetadata = {
      ...metadata,
      totalRunDurationMs: metadata.totalRunDurationMs ?? existing?.totalRunDurationMs,
    }
    this.byId.set(metadata.terminalId, merged)
    // Persist on the daemon session (keyed by terminalId == sessionId) so the
    // label and run time survive an app restart.
    this.persist(metadata.terminalId, toDaemon(merged))
  }

  addRunDuration(terminalId: string, deltaMs: number): void {
    if (deltaMs <= 0) return
    const existing = this.byId.get(terminalId)
    if (!existing) return
    existing.totalRunDurationMs = (existing.totalRunDurationMs ?? 0) + deltaMs
    // Persist to the daemon so accumulated agent time survives an app restart.
    this.persist(terminalId, toDaemon(existing))
  }

  /**
   * Rebuild from the daemon after an app restart: the daemon keeps PTYs (and
   * their persisted labels) alive, but this process starts empty. Returns the
   * sessions that are tracked big terminals.
   */
  hydrate(sessions: readonly SessionInfo[]): SessionInfo[] {
    const tracked: SessionInfo[] = []
    for (const session of sessions) {
      const metadata = session.metadata
      // Require metadata (a label/agent/worktree). A "bt-" daemon session with
      // no metadata is an orphan the desktop no longer tracks as a tab (the
      // renderer only re-syncs labels for terminals in its persisted list).
      // Registering it would leak a stale, label-less terminal to mobile.
      if (!metadata || (!metadata.label && !metadata.agentId && !metadata.worktreeId)) continue
      // For big terminals the daemon sessionId is the stable terminalId.
      this.byId.set(session.sessionId, {
        terminalId: session.sessionId,
        label: metadata.label,
        agentId: metadata.agentId,
        worktreeId: metadata.worktreeId,
        totalRunDurationMs: metadata.totalRunDurationMs,
      })
      tracked.push(session)
    }
    return tracked
  }
}

function toDaemon(m: BigTerminalMetadata): DaemonSessionMetadata {
  return { label: m.label, agentId: m.agentId, worktreeId: m.worktreeId, totalRunDurationMs: m.totalRunDurationMs }
}
