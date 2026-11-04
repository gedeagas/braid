import { type StateCreator } from 'zustand'
import type { UIState } from './types'
import type { CenterView } from './layout'
import { SK } from '@/lib/storageKeys'

/**
 * Optional second center pane per worktree. With no split the center works
 * exactly as before: `tabOrder` + `activeCenterViewByWorktree` are the primary
 * pane. Keys moved into the secondary pane are hidden from the primary tab bar.
 */
export type PaneId = 'primary' | 'secondary'

export interface CenterSplit {
  /** Tab keys (t:, b:, f:) living in the secondary pane, in tab-bar order. */
  secondaryKeys: string[]
  secondaryView: CenterView | null
  focused: PaneId
  /** Primary pane share of the width, 0.2 - 0.8. */
  ratio: number
}

export const DEFAULT_SPLIT_RATIO = 0.5

/** Chat sessions can't move: ChatView renders the single global active session. */
export function canMoveToSecondary(key: string): boolean {
  return key.startsWith('t:') || key.startsWith('b:') || key.startsWith('f:')
}

export function keyToView(key: string): CenterView | null {
  if (key.startsWith('s:')) return { type: 'session', sessionId: key.slice(2) }
  if (key.startsWith('f:')) return { type: 'file', path: key.slice(2) }
  if (key.startsWith('t:')) return { type: 'terminal', terminalId: key.slice(2) }
  if (key.startsWith('b:')) return { type: 'browser', tabId: key.slice(2) }
  if (key === 'changes') return { type: 'changes' }
  if (key === 'codeReview') return { type: 'codeReview' }
  return null
}

/** Unified tab-bar key for a center view (s:, f:, t:, b:, changes, codeReview). */
export function centerViewToTabKey(view: CenterView | null | undefined): string | null {
  if (view?.type === 'session') return `s:${view.sessionId}`
  if (view?.type === 'file') return `f:${view.path}`
  if (view?.type === 'changes') return 'changes'
  if (view?.type === 'terminal') return `t:${view.terminalId}`
  if (view?.type === 'browser') return `b:${view.tabId}`
  if (view?.type === 'codeReview') return 'codeReview'
  return null
}

function loadSplit(worktreeId: string): CenterSplit | null {
  try {
    const raw = localStorage.getItem(SK.centerSplitPrefix + worktreeId)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<CenterSplit>
    if (!Array.isArray(p.secondaryKeys)) return null
    const keys = p.secondaryKeys.filter((k): k is string => typeof k === 'string' && canMoveToSecondary(k))
    if (keys.length === 0) return null
    return {
      secondaryKeys: keys,
      secondaryView: p.secondaryView ?? keyToView(keys[0]),
      focused: p.focused === 'secondary' ? 'secondary' : 'primary',
      ratio: typeof p.ratio === 'number' ? Math.min(0.8, Math.max(0.2, p.ratio)) : DEFAULT_SPLIT_RATIO,
    }
  } catch {
    return null
  }
}

function saveSplit(worktreeId: string, split: CenterSplit | null): void {
  try {
    if (!split) localStorage.removeItem(SK.centerSplitPrefix + worktreeId)
    else localStorage.setItem(SK.centerSplitPrefix + worktreeId, JSON.stringify(split))
  } catch {}
}

function loadAllSplits(): Record<string, CenterSplit> {
  const out: Record<string, CenterSplit> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(SK.centerSplitPrefix)) continue
      const wt = key.slice(SK.centerSplitPrefix.length)
      const split = loadSplit(wt)
      if (split) out[wt] = split
    }
  } catch {}
  return out
}

export interface CenterSplitSlice {
  centerSplitByWorktree: Record<string, CenterSplit>
  /** Move a tab into a pane (creating/collapsing the split as needed) and show it there. */
  moveTabToPane: (worktreeId: string, key: string, pane: PaneId) => void
  /** Show a key that already lives in the secondary pane. */
  setSecondaryView: (worktreeId: string, view: CenterView | null) => void
  setSecondaryKeys: (worktreeId: string, keys: string[]) => void
  setFocusedPane: (worktreeId: string, pane: PaneId) => void
  setSplitRatio: (worktreeId: string, ratio: number) => void
  /** Merge the secondary pane back into the primary one. */
  closeSplit: (worktreeId: string) => void
}

export const createCenterSplitSlice: StateCreator<UIState, [], [], CenterSplitSlice> = (set, get) => {
  const write = (worktreeId: string, split: CenterSplit | null) => {
    saveSplit(worktreeId, split)
    set((s) => {
      const next = { ...s.centerSplitByWorktree }
      if (split) next[worktreeId] = split
      else delete next[worktreeId]
      return { centerSplitByWorktree: next }
    })
  }

  return {
    centerSplitByWorktree: loadAllSplits(),

    moveTabToPane: (worktreeId, key, pane) => {
      const view = keyToView(key)
      if (!view) return
      const current = get().centerSplitByWorktree[worktreeId] ?? null
      if (pane === 'secondary') {
        if (!canMoveToSecondary(key)) return
        // The primary pane shows the moved tab? Fall back to the nearest remaining primary tab.
        const primaryView = get().activeCenterViewByWorktree[worktreeId] ?? null
        const secondaryKeys = [...(current?.secondaryKeys ?? []).filter((k) => k !== key), key]
        if (primaryView && keyToView(key) && JSON.stringify(primaryView) === JSON.stringify(view)) {
          const order = get().tabOrder.filter((k) => !secondaryKeys.includes(k))
          const idx = Math.max(0, get().tabOrder.indexOf(key))
          const fallbackKey = order[Math.min(idx, order.length - 1)]
          get().setActiveCenterView(fallbackKey ? keyToView(fallbackKey) : null)
        }
        write(worktreeId, { secondaryKeys, secondaryView: view, focused: 'secondary', ratio: current?.ratio ?? DEFAULT_SPLIT_RATIO })
        return
      }
      // Into the primary pane.
      if (current) {
        const secondaryKeys = current.secondaryKeys.filter((k) => k !== key)
        if (secondaryKeys.length === 0) write(worktreeId, null)
        else {
          const stillShown = current.secondaryView && JSON.stringify(current.secondaryView) !== JSON.stringify(view)
          write(worktreeId, { ...current, secondaryKeys, secondaryView: stillShown ? current.secondaryView : keyToView(secondaryKeys[0]), focused: 'primary' })
        }
      }
      get().setActiveCenterView(view)
    },

    setSecondaryView: (worktreeId, view) => {
      const current = get().centerSplitByWorktree[worktreeId]
      if (!current) return
      write(worktreeId, { ...current, secondaryView: view, focused: 'secondary' })
    },

    setSecondaryKeys: (worktreeId, keys) => {
      const current = get().centerSplitByWorktree[worktreeId]
      if (!current) return
      const valid = keys.filter(canMoveToSecondary)
      if (valid.length === 0) { write(worktreeId, null); return }
      const viewKeyStillThere = current.secondaryView && valid.some((k) => JSON.stringify(keyToView(k)) === JSON.stringify(current.secondaryView))
      write(worktreeId, { ...current, secondaryKeys: valid, secondaryView: viewKeyStillThere ? current.secondaryView : keyToView(valid[0]) })
    },

    setFocusedPane: (worktreeId, pane) => {
      const current = get().centerSplitByWorktree[worktreeId]
      if (!current || current.focused === pane) return
      write(worktreeId, { ...current, focused: pane })
    },

    setSplitRatio: (worktreeId, ratio) => {
      const current = get().centerSplitByWorktree[worktreeId]
      if (!current) return
      write(worktreeId, { ...current, ratio: Math.min(0.8, Math.max(0.2, ratio)) })
    },

    closeSplit: (worktreeId) => {
      const current = get().centerSplitByWorktree[worktreeId]
      if (!current) return
      write(worktreeId, null)
      // Keep what the user was looking at in the focused pane.
      if (current.focused === 'secondary' && current.secondaryView) get().setActiveCenterView(current.secondaryView)
    },
  }
}
