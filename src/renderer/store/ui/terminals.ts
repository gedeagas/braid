import { type StateCreator } from 'zustand'
import type { UIState } from './types'
import type { CenterView } from './layout'
import type { AgentStatusEntry, AgentStatusPayload } from '@/lib/agentStatus'
import { createAgentStatusEntry, updateAgentStatusEntry } from '@/lib/agentStatus'
import * as ipc from '@/lib/ipc'
import { SK } from '@/lib/storageKeys'

export interface BigTerminalTab {
  id: string
  label: string
  /** Command to auto-run when the PTY first spawns (e.g. "claude"). Not re-run on restore. */
  initialCommand?: string
  /** Initial text to paste into the freshly launched agent. Not persisted or restored. */
  initialInput?: string
  /** Agent catalog id (e.g. 'claude', 'codex', 'gemini'). Used for icon rendering and tab persistence. */
  agentId?: string
}

// Module-level counter to keep terminal ids unique even within the same ms
let _btCounter = 0
function nextBigTerminalId(): string {
  _btCounter++
  return `bt-${Date.now()}-${_btCounter}`
}

/** Load the persisted big terminal tab list for a worktree. */
function loadBigTerminalsFor(worktreeId: string): BigTerminalTab[] {
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
 * without this the last-selected worktree's terminals would have a name on the
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
function pushKnownBigTerminals(): void {
  try {
    ipc.pty.setKnownBigTerminals(getAllPersistedBigTerminals())
  } catch {}
}

function saveBigTerminalsFor(worktreeId: string, tabs: BigTerminalTab[]): void {
  try {
    const persisted = tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      ...(tab.agentId ? { agentId: tab.agentId } : {}),
    }))
    localStorage.setItem(SK.bigTerminalTabsPrefix + worktreeId, JSON.stringify(persisted))
  } catch {}
  // Keep the main process's known-id set in sync so mobile's daemon-sourced
  // terminal.list reflects creates/closes/renames without a restart.
  pushKnownBigTerminals()
}

function syncBigTerminalMetadata(worktreeId: string, tab: BigTerminalTab): void {
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
function broadcastBigTerminalRename(worktreeId: string, tab: BigTerminalTab): void {
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
function killAndForgetBigTerminal(terminalId: string): void {
  try {
    ipc.pty.killBigTerminal(terminalId)
  } catch {}
}

/** Initial hydration for the last-selected worktree (mirrors layout.ts openFilePaths pattern). */
function loadInitial(): Record<string, BigTerminalTab[]> {
  try {
    const wtId = localStorage.getItem(SK.selectedWorktreeId)
    if (wtId) return { [wtId]: loadBigTerminalsFor(wtId) }
  } catch {}
  return {}
}

// Persist the active center view for a worktree, mirroring layout.setActiveCenterView's
// localStorage write. Used when closing a terminal reconciles the active view so the
// change survives a reload even for a worktree that isn't currently selected.
function persistActiveView(worktreeId: string, view: CenterView | null): void {
  if (!worktreeId) return
  try { localStorage.setItem(SK.activeCenterViewPrefix + worktreeId, JSON.stringify(view)) } catch {}
}

// Read the persisted active center view for a worktree. The store only hydrates
// activeCenterViewByWorktree for the last-selected worktree (see loadInitial), so
// for any other worktree the in-memory entry is absent even when localStorage has
// one. Returns undefined when nothing is persisted. Mirrors loadBigTerminalsFor.
function loadActiveViewFor(worktreeId: string): CenterView | null | undefined {
  if (!worktreeId) return undefined
  try {
    const raw = localStorage.getItem(SK.activeCenterViewPrefix + worktreeId)
    return raw == null ? undefined : (JSON.parse(raw) as CenterView | null)
  } catch { return undefined }
}

// When the closed terminal was the active center view, pick its replacement: the
// adjacent remaining terminal (same "clamp to last" rule as TabbedTerminal.closeTab),
// or null when none remain (CenterPanel then falls back to the active session / empty).
// Returns undefined when the closed terminal wasn't the active view (no change needed).
function nextViewAfterClose(
  view: CenterView | null | undefined,
  closedId: string,
  remaining: BigTerminalTab[],
  closedIndex: number,
): CenterView | null | undefined {
  if (!(view?.type === 'terminal' && view.terminalId === closedId)) return undefined
  if (remaining.length === 0) return null
  const idx = Math.min(Math.max(closedIndex, 0), remaining.length - 1)
  return { type: 'terminal', terminalId: remaining[idx].id }
}

export interface TerminalsSlice {
  bigTerminalsByWorktree: Record<string, BigTerminalTab[]>
  /** In-memory agent status map with full entry (not persisted). Keyed by terminalId. */
  bigTerminalStatusById: Record<string, AgentStatusEntry>
  createBigTerminal: (worktreeId: string, label?: string, initialCommand?: string, agentId?: string, initialInput?: string) => string
  /** Register a terminal created outside the local renderer, e.g. from the mobile app. */
  registerRemoteBigTerminal: (worktreeId: string, tab: BigTerminalTab) => void
  renameBigTerminal: (worktreeId: string, id: string, label: string) => void
  /** Apply a rename that originated elsewhere (another window or a mobile device). No metadata re-sync. */
  applyRemoteBigTerminalRename: (worktreeId: string, id: string, label: string) => void
  closeBigTerminal: (worktreeId: string, id: string) => void
  /** Remove a tab whose PTY was already closed elsewhere (another window or a mobile device). No kill. */
  removeRemoteBigTerminal: (worktreeId: string, id: string) => void
  reorderBigTerminals: (worktreeId: string, fromIndex: number, toIndex: number) => void
  /** Update agent status for a big terminal. Creates entry if not present, merges otherwise. */
  updateBigTerminalStatus: (terminalId: string, payload: AgentStatusPayload) => void
  clearBigTerminalStatus: (terminalId: string) => void
  /** Called internally by layout.selectWorktree to hydrate when switching worktrees. */
  restoreBigTerminalsForWorktree: (worktreeId: string) => void
  /** Called on worktree removal. */
  clearBigTerminalsForWorktree: (worktreeId: string) => void
}

export const createTerminalsSlice: StateCreator<UIState, [], [], TerminalsSlice> = (set, get) => ({
  bigTerminalsByWorktree: loadInitial(),
  bigTerminalStatusById: {},

  createBigTerminal: (worktreeId, label, initialCommand, agentId, initialInput) => {
    const id = nextBigTerminalId()
    let createdTab: BigTerminalTab | null = null
    set((s) => {
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? []
      const maxNum = existing.reduce((max, t) => {
        const m = t.label.match(/^Terminal (\d+)$/)
        return m ? Math.max(max, Number(m[1])) : max
      }, 0)
      const nextLabel = label ?? `Terminal ${maxNum + 1}`
      const tab: BigTerminalTab = { id, label: nextLabel }
      if (initialCommand) tab.initialCommand = initialCommand
      if (initialInput) tab.initialInput = initialInput
      if (agentId) tab.agentId = agentId
      createdTab = tab
      const next = [...existing, tab]
      saveBigTerminalsFor(worktreeId, next)
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next } }
    })
    if (createdTab) syncBigTerminalMetadata(worktreeId, createdTab)
    return id
  },

  registerRemoteBigTerminal: (worktreeId, tab) => {
    set((s) => {
      // Hydrate from persisted storage when this worktree hasn't been loaded
      // this session, so a remote registration doesn't clobber existing tabs.
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? loadBigTerminalsFor(worktreeId)
      const next = existing.some((t) => t.id === tab.id)
        ? existing.map((t) => (t.id === tab.id ? { ...t, ...tab } : t))
        : [...existing, tab]
      saveBigTerminalsFor(worktreeId, next)
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next } }
    })
  },

  renameBigTerminal: (worktreeId, id, label) => {
    const trimmed = label.trim() || 'Terminal'
    const current = get().bigTerminalsByWorktree[worktreeId]?.find((tab) => tab.id === id)
    set((s) => {
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? []
      const next = existing.map((t) => (t.id === id ? { ...t, label: trimmed } : t))
      saveBigTerminalsFor(worktreeId, next)
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next } }
    })
    broadcastBigTerminalRename(worktreeId, { ...(current ?? { id, label: trimmed }), label: trimmed })
  },

  applyRemoteBigTerminalRename: (worktreeId, id, label) => {
    const trimmed = label.trim() || 'Terminal'
    set((s) => {
      // Hydrate from storage if this worktree hasn't been loaded this session,
      // so a remote rename doesn't clobber persisted tabs.
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? loadBigTerminalsFor(worktreeId)
      if (!existing.some((t) => t.id === id)) return s
      const next = existing.map((t) => (t.id === id ? { ...t, label: trimmed } : t))
      saveBigTerminalsFor(worktreeId, next)
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next } }
    })
    // No metadata re-sync: the change originated on the main process, which is
    // already authoritative. Re-syncing would echo a redundant broadcast.
  },

  removeRemoteBigTerminal: (worktreeId, id) => {
    // Mirror closeBigTerminal minus the kill - the PTY was already reaped by
    // whoever initiated the close (another window or a mobile device).
    set((s) => {
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? loadBigTerminalsFor(worktreeId)
      const closedIndex = existing.findIndex((t) => t.id === id)
      if (closedIndex === -1) return s
      const next = existing.filter((t) => t.id !== id)
      saveBigTerminalsFor(worktreeId, next)
      const statusNext = { ...s.bigTerminalStatusById }
      delete statusNext[id]
      // If the desktop was viewing this exact terminal (same worktree), switch to
      // the next tab so the close is instant instead of leaving a dead pane.
      // The remote close can target a worktree that isn't hydrated this session, so
      // fall back to the persisted active view (the `in` check keeps an explicit
      // in-memory `null` from being overridden). Without this, a stale persisted
      // active view would survive and surface a dead pane on next selection.
      const currentView = (s.activeCenterViewByWorktree && worktreeId in s.activeCenterViewByWorktree)
        ? s.activeCenterViewByWorktree[worktreeId]
        : loadActiveViewFor(worktreeId)
      const nextView = nextViewAfterClose(currentView, id, next, closedIndex)
      const viewUpdate = nextView === undefined ? {} : (() => {
        persistActiveView(worktreeId, nextView)
        return { activeCenterViewByWorktree: { ...s.activeCenterViewByWorktree, [worktreeId]: nextView } }
      })()
      return {
        bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next },
        bigTerminalStatusById: statusNext,
        ...viewUpdate,
      }
    })
  },

  closeBigTerminal: (worktreeId, id) => {
    killAndForgetBigTerminal(id)
    set((s) => {
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? []
      const closedIndex = existing.findIndex((t) => t.id === id)
      const next = existing.filter((t) => t.id !== id)
      saveBigTerminalsFor(worktreeId, next)
      // Clean up ephemeral agent status
      const statusNext = { ...s.bigTerminalStatusById }
      delete statusNext[id]
      // Jump to the next terminal (or empty) when the closed tab was the active one.
      const nextView = nextViewAfterClose(s.activeCenterViewByWorktree?.[worktreeId], id, next, closedIndex)
      const viewUpdate = nextView === undefined ? {} : (() => {
        persistActiveView(worktreeId, nextView)
        return { activeCenterViewByWorktree: { ...s.activeCenterViewByWorktree, [worktreeId]: nextView } }
      })()
      return {
        bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next },
        bigTerminalStatusById: statusNext,
        ...viewUpdate,
      }
    })
  },

  reorderBigTerminals: (worktreeId, fromIndex, toIndex) => {
    set((s) => {
      const existing = [...(s.bigTerminalsByWorktree[worktreeId] ?? [])]
      if (fromIndex < 0 || fromIndex >= existing.length || toIndex < 0 || toIndex >= existing.length) return s
      const [moved] = existing.splice(fromIndex, 1)
      existing.splice(toIndex, 0, moved)
      saveBigTerminalsFor(worktreeId, existing)
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: existing } }
    })
  },

  updateBigTerminalStatus: (terminalId, payload) => {
    set((s) => {
      const prev = s.bigTerminalStatusById[terminalId]
      let next: AgentStatusEntry
      if (prev) {
        next = updateAgentStatusEntry(prev, payload)
        if (next === prev) return s
      } else {
        // Create initial entry, then merge full payload to capture toolName etc.
        const initial = createAgentStatusEntry(payload.state, payload.agentType, payload.source)
        next = payload.toolName ? { ...initial, toolName: payload.toolName } : initial
      }
      return { bigTerminalStatusById: { ...s.bigTerminalStatusById, [terminalId]: next } }
    })
  },

  clearBigTerminalStatus: (terminalId) => {
    set((s) => {
      const next = { ...s.bigTerminalStatusById }
      delete next[terminalId]
      return { bigTerminalStatusById: next }
    })
  },

  restoreBigTerminalsForWorktree: (worktreeId) => {
    set((s) => {
      if (s.bigTerminalsByWorktree[worktreeId] !== undefined) return s // already hydrated
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: loadBigTerminalsFor(worktreeId) } }
    })
    // Re-sync metadata to the daemon/adapter for the worktree's CURRENT tabs,
    // even when state was already hydrated. loadInitial() populates the
    // last-selected worktree at store creation without syncing, so without this
    // its terminals would have a label on the desktop (renderer state) but none
    // in the daemon - leaving the mobile app (and cold-start hydrate) with an
    // unnamed terminal. Syncing is idempotent, so doing it on every visit is safe.
    const tabs = get().bigTerminalsByWorktree[worktreeId] ?? []
    tabs.forEach((tab) => syncBigTerminalMetadata(worktreeId, tab))
  },

  clearBigTerminalsForWorktree: (worktreeId) => {
    get().bigTerminalsByWorktree[worktreeId]?.forEach((tab) => killAndForgetBigTerminal(tab.id))
    try { localStorage.removeItem(SK.bigTerminalTabsPrefix + worktreeId) } catch {}
    set((s) => {
      const next = { ...s.bigTerminalsByWorktree }
      delete next[worktreeId]
      return { bigTerminalsByWorktree: next }
    })
  },
})

// ─── Derived selector ───────────────────────────────────────────────────────

export const selectBigTerminalsForActiveWorktree = (s: UIState): BigTerminalTab[] =>
  s.bigTerminalsByWorktree[s.selectedWorktreeId ?? ''] ?? []
