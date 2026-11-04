// Big terminal tab persistence (localStorage) and daemon metadata sync.
// Split out of terminals.ts to keep the slice under the file size limit.

import type { CenterView } from './layout'
import * as ipc from '@/lib/ipc'
import { SK } from '@/lib/storageKeys'
import { normalizeResumeSession, type AgentResumeSession } from '@shared/agent-resume'

export interface BigTerminalTab {
  id: string
  label: string
  /** Command to auto-run when the PTY first spawns (e.g. "claude"). Not re-run on restore. */
  initialCommand?: string
  /** Initial text to paste into the freshly launched agent. Not persisted or restored. */
  initialInput?: string
  /** Agent catalog id (e.g. 'claude', 'codex', 'gemini'). Used for icon rendering and tab persistence. */
  agentId?: string
  /**
   * The agent conversation running in this tab, as reported by its hooks.
   * Persisted so a cold restore (daemon session gone) can relaunch the agent
   * into the same conversation instead of leaving a dead shell.
   */
  resume?: AgentResumeSession
}

/** Load the persisted big terminal tab list for a worktree. */
export function loadBigTerminalsFor(worktreeId: string): BigTerminalTab[] {
  try {
    const raw = localStorage.getItem(SK.bigTerminalTabsPrefix + worktreeId)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is { id: unknown; label: unknown } =>
        typeof x === 'object' && x !== null && 'id' in x && 'label' in x)
      .map((x) => {
        const tab: BigTerminalTab = { id: String(x.id), label: String(x.label) }
        if ('agentId' in (x as Record<string, unknown>) && typeof (x as Record<string, unknown>).agentId === 'string') {
          tab.agentId = (x as Record<string, unknown>).agentId as string
        }
        // Stored data is untrusted (it ends up typed into a shell): re-validate.
        const resume = normalizeResumeSession((x as Record<string, unknown>).resume)
        if (resume) tab.resume = resume
        return tab
      })
  } catch {
    return []
  }
}

/**
 * Every persisted big-terminal id across ALL worktrees. This is the desktop's
 * authoritative "what should exist" set, used to detect orphaned daemon
 * sessions (live "bt-" terminals not referenced by any persisted tab). Scans
 * every localStorage key under the big-terminal prefix, not just the active
 * worktree, so the orphan check never reaps a terminal in a worktree the user
 * simply hasn't reopened this session.
 */
export function getAllPersistedBigTerminalIds(): string[] {
  return getAllPersistedBigTerminals().map((tab) => tab.terminalId)
}

export interface PersistedBigTerminal {
  terminalId: string
  label?: string
  agentId?: string
  worktreeId?: string
}

/**
 * Every persisted big terminal across ALL worktrees, with its label/agent. The
 * mobile app needs the label here (not just the id) because a terminal's name
 * lives in renderer state and isn't always in the daemon's metadata - pushing it
 * to main lets terminal.list show the real name for terminals in worktrees the
 * desktop hasn't reopened this session.
 */
export function getAllPersistedBigTerminals(): PersistedBigTerminal[] {
  const result: PersistedBigTerminal[] = []
  try {
    const prefix = SK.bigTerminalTabsPrefix
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const worktreeId = key.slice(prefix.length)
      for (const tab of loadBigTerminalsFor(worktreeId)) {
        result.push({ terminalId: tab.id, label: tab.label, agentId: tab.agentId, worktreeId })
      }
    }
  } catch {
    // Best effort - an empty set just means the cleanup finds "everything" an
    // orphan, which the manual review step guards against.
  }
  return result
}

/**
 * Push every persisted big terminal's metadata (label/agent/worktree) to the
 * daemon once on startup. loadInitial() only hydrates renderer state, and
 * restoreBigTerminalsForWorktree only fires on an explicit worktree select - so
 * without this persisted terminals would have a name on the
 * desktop but none in the daemon, leaving the mobile app (and cold-start
 * hydrate) showing unnamed terminals. setMetadata is a no-op on the daemon for
 * sessions that no longer exist, so this can't resurrect orphans.
 */
export function syncAllPersistedBigTerminalMetadata(): void {
  try {
    const prefix = SK.bigTerminalTabsPrefix
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const worktreeId = key.slice(prefix.length)
      for (const tab of loadBigTerminalsFor(worktreeId)) syncBigTerminalMetadata(worktreeId, tab)
    }
  } catch {
    // Best effort - the per-worktree sync on select still covers the active one.
  }
  pushKnownBigTerminals()
}

/**
 * Tell the main process the full set of big-terminal ids we track (across all
 * worktrees). The mobile terminal.list intersects the daemon's session list with
 * this set, so it can surface terminals in worktrees the desktop hasn't reopened
 * while still excluding orphaned daemon sessions. Pushed on startup and after any
 * tab create/close/rename (every saveBigTerminalsFor).
 */
export function pushKnownBigTerminals(): void {
  try {
    ipc.pty.setKnownBigTerminals(getAllPersistedBigTerminals())
  } catch {}
}

export function saveBigTerminalsFor(worktreeId: string, tabs: BigTerminalTab[]): void {
  try {
    const persisted = tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      ...(tab.agentId ? { agentId: tab.agentId } : {}),
      ...(tab.resume ? { resume: tab.resume } : {}),
    }))
    localStorage.setItem(SK.bigTerminalTabsPrefix + worktreeId, JSON.stringify(persisted))
  } catch {}
  // Keep the main process's known-id set in sync so mobile's daemon-sourced
  // terminal.list reflects creates/closes/renames without a restart.
  pushKnownBigTerminals()
}

export function syncBigTerminalMetadata(worktreeId: string, tab: BigTerminalTab): void {
  try {
    ipc.pty.setBigTerminalMetadata({
      terminalId: tab.id,
      worktreeId,
      label: tab.label,
      agentId: tab.agentId,
    })
  } catch {}
}

// A user-initiated rename: persists the new label on the main process AND fans
// it out to other desktop windows + every connected mobile device so the tab
// strip updates live everywhere. (setBigTerminalMetadata alone doesn't notify.)
export function broadcastBigTerminalRename(worktreeId: string, tab: BigTerminalTab): void {
  try {
    ipc.pty.renameBigTerminal({
      terminalId: tab.id,
      worktreeId,
      label: tab.label,
      agentId: tab.agentId,
    })
  } catch {}
}

// Kill the underlying PTY and forget its metadata. Killing by terminalId (not
// ptyId) reaps the session even when this renderer never mounted/cached it -
// otherwise a closed big terminal lingers as an orphaned daemon session and
// resurfaces (e.g. to the mobile app) with no label. The service-side
// killBigTerminal also clears the metadata, so no separate remove is needed.
export function killAndForgetBigTerminal(terminalId: string): void {
  try {
    ipc.pty.killBigTerminal(terminalId)
  } catch {}
}

/**
 * Initial hydration for EVERY worktree with persisted tabs. Sidebar rows and
 * Mission Control read bigTerminalsByWorktree for all worktrees, so hydrating
 * only the last-selected one left every other row's agent count empty until
 * the user clicked it.
 */
export function loadInitial(): Record<string, BigTerminalTab[]> {
  const result: Record<string, BigTerminalTab[]> = {}
  try {
    const prefix = SK.bigTerminalTabsPrefix
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const worktreeId = key.slice(prefix.length)
      if (worktreeId) result[worktreeId] = loadBigTerminalsFor(worktreeId)
    }
  } catch {}
  return result
}

// Persist the active center view for a worktree, mirroring layout.setActiveCenterView's
// localStorage write. Used when closing a terminal reconciles the active view so the
// change survives a reload even for a worktree that isn't currently selected.
export function persistActiveView(worktreeId: string, view: CenterView | null): void {
  if (!worktreeId) return
  try { localStorage.setItem(SK.activeCenterViewPrefix + worktreeId, JSON.stringify(view)) } catch {}
}

// Read the persisted active center view for a worktree. The store only hydrates
// activeCenterViewByWorktree for the last-selected worktree (see layout.ts), so
// for any other worktree the in-memory entry is absent even when localStorage has
// one. Returns undefined when nothing is persisted. Mirrors loadBigTerminalsFor.
export function loadActiveViewFor(worktreeId: string): CenterView | null | undefined {
  if (!worktreeId) return undefined
  try {
    const raw = localStorage.getItem(SK.activeCenterViewPrefix + worktreeId)
    return raw == null ? undefined : (JSON.parse(raw) as CenterView | null)
  } catch { return undefined }
}
