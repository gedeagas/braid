import { type StateCreator } from 'zustand'
import type { UIState } from './types'
import type { CenterView } from './layout'
import type { AgentStatusEntry, AgentStatusPayload } from '@/lib/agentStatus'
import { createAgentStatusEntry, updateAgentStatusEntry } from '@/lib/agentStatus'
import { SK } from '@/lib/storageKeys'
import type { AgentResumeSession } from '@shared/agent-resume'

import {
  type BigTerminalTab,
  loadBigTerminalsFor,
  saveBigTerminalsFor,
  syncBigTerminalMetadata,
  broadcastBigTerminalRename,
  killAndForgetBigTerminal,
  loadInitial,
  persistActiveView,
  loadActiveViewFor,
} from './terminalsPersistence'

export type { BigTerminalTab, PersistedBigTerminal } from './terminalsPersistence'
export {
  getAllPersistedBigTerminalIds,
  getAllPersistedBigTerminals,
  syncAllPersistedBigTerminalMetadata,
} from './terminalsPersistence'

// Module-level counter to keep terminal ids unique even within the same ms
let _btCounter = 0
function nextBigTerminalId(): string {
  _btCounter++
  return `bt-${Date.now()}-${_btCounter}`
}

function sameResumeSession(a: AgentResumeSession | undefined, b: AgentResumeSession | undefined): boolean {
  if (!a || !b) return a === b
  return a.agent === b.agent && a.id === b.id && a.cwd === b.cwd
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
  /** Record (or, with null, forget) the agent conversation running in a big terminal. */
  setBigTerminalResumeSession: (terminalId: string, session: AgentResumeSession | null) => void
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

  setBigTerminalResumeSession: (terminalId, session) => {
    set((s) => {
      for (const [worktreeId, tabs] of Object.entries(s.bigTerminalsByWorktree)) {
        const index = tabs.findIndex((t) => t.id === terminalId)
        if (index === -1) continue
        const tab = tabs[index]
        if (sameResumeSession(tab.resume, session ?? undefined)) return s
        const nextTab: BigTerminalTab = { ...tab }
        if (session) nextTab.resume = session
        else delete nextTab.resume
        const next = tabs.map((t, i) => (i === index ? nextTab : t))
        saveBigTerminalsFor(worktreeId, next)
        return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next } }
      }
      return s // unknown terminal (closed, or never ours)
    })
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
