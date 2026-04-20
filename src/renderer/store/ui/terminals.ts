import { type StateCreator } from 'zustand'
import type { UIState } from './types'
import { SK } from '@/lib/storageKeys'

export interface BigTerminalTab {
  id: string
  label: string
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
      .map((x) => ({ id: String(x.id), label: String(x.label) }))
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
  createBigTerminal: (worktreeId: string, label?: string) => string
  renameBigTerminal: (worktreeId: string, id: string, label: string) => void
  closeBigTerminal: (worktreeId: string, id: string) => void
  reorderBigTerminals: (worktreeId: string, fromIndex: number, toIndex: number) => void
  /** Called internally by layout.selectWorktree to hydrate when switching worktrees. */
  restoreBigTerminalsForWorktree: (worktreeId: string) => void
  /** Called on worktree removal. */
  clearBigTerminalsForWorktree: (worktreeId: string) => void
}

export const createTerminalsSlice: StateCreator<UIState, [], [], TerminalsSlice> = (set, get) => ({
  bigTerminalsByWorktree: loadInitial(),

  createBigTerminal: (worktreeId, label) => {
    const id = nextBigTerminalId()
    set((s) => {
      const existing = s.bigTerminalsByWorktree[worktreeId] ?? []
      const maxNum = existing.reduce((max, t) => {
        const m = t.label.match(/^Terminal (\d+)$/)
        return m ? Math.max(max, Number(m[1])) : max
      }, 0)
      const nextLabel = label ?? `Terminal ${maxNum + 1}`
      const next = [...existing, { id, label: nextLabel }]
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
      return { bigTerminalsByWorktree: { ...s.bigTerminalsByWorktree, [worktreeId]: next } }
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
