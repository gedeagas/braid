import { type StateCreator } from 'zustand'
import type { UIState } from './types'
import type { AgentStatusEntry, AgentStatusPayload } from '@/lib/agentStatus'
import { createAgentStatusEntry, updateAgentStatusEntry } from '@/lib/agentStatus'
import { SK } from '@/lib/storageKeys'

export interface BigTerminalTab {
  id: string
  label: string
  /** Command to auto-run when the PTY first spawns (e.g. "claude"). Not re-run on restore. */
  initialCommand?: string
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

function saveBigTerminalsFor(worktreeId: string, tabs: BigTerminalTab[]): void {
  try {
    localStorage.setItem(SK.bigTerminalTabsPrefix + worktreeId, JSON.stringify(tabs))
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

export interface TerminalsSlice {
  bigTerminalsByWorktree: Record<string, BigTerminalTab[]>
  /** In-memory agent status map with full entry (not persisted). Keyed by terminalId. */
  bigTerminalStatusById: Record<string, AgentStatusEntry>
  createBigTerminal: (worktreeId: string, label?: string, initialCommand?: string, agentId?: string) => string
  renameBigTerminal: (worktreeId: string, id: string, label: string) => void
  closeBigTerminal: (worktreeId: string, id: string) => void
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

  createBigTerminal: (worktreeId, label, initialCommand, agentId) => {
    const id = nextBigTerminalId()
    set((s) => {
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? []
      const maxNum = existing.reduce((max, t) => {
        const m = t.label.match(/^Terminal (\d+)$/)
        return m ? Math.max(max, Number(m[1])) : max
      }, 0)
      const nextLabel = label ?? `Terminal ${maxNum + 1}`
      const tab: BigTerminalTab = { id, label: nextLabel }
      if (initialCommand) tab.initialCommand = initialCommand
      if (agentId) tab.agentId = agentId
      const next = [...existing, tab]
      saveBigTerminalsFor(worktreeId, next)
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next } }
    })
    return id
  },

  renameBigTerminal: (worktreeId, id, label) => {
    const trimmed = label.trim() || 'Terminal'
    set((s) => {
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? []
      const next = existing.map((t) => (t.id === id ? { ...t, label: trimmed } : t))
      saveBigTerminalsFor(worktreeId, next)
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next } }
    })
  },

  closeBigTerminal: (worktreeId, id) => {
    set((s) => {
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? []
      const next = existing.filter((t) => t.id !== id)
      saveBigTerminalsFor(worktreeId, next)
      // Clean up ephemeral agent status
      const statusNext = { ...s.bigTerminalStatusById }
      delete statusNext[id]
      return {
        bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next },
        bigTerminalStatusById: statusNext
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
      const loaded = loadBigTerminalsFor(worktreeId)
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: loaded } }
    })
  },

  clearBigTerminalsForWorktree: (worktreeId) => {
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
