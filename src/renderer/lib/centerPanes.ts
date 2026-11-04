/**
 * Pane-aware helpers over the center layout (primary pane + optional
 * secondary pane). Read fresh store state on every call.
 */
import { useUIStore, keyToView, canMoveToSecondary, type CenterView, type PaneId } from '@/store/ui'

export interface PaneLayout {
  panes: Array<{ id: PaneId; view: CenterView | null }>
  focusedPaneId: PaneId
}

export function getPaneLayout(worktreeId: string): PaneLayout {
  const ui = useUIStore.getState()
  const primary = ui.activeCenterViewByWorktree[worktreeId] ?? null
  const split = ui.centerSplitByWorktree[worktreeId]
  if (!split) return { panes: [{ id: 'primary', view: primary }], focusedPaneId: 'primary' }
  return {
    panes: [{ id: 'primary', view: primary }, { id: 'secondary', view: split.secondaryView }],
    focusedPaneId: split.focused,
  }
}

/** Pane holding a tab key in the selected worktree. */
export function paneOfKey(worktreeId: string, key: string): PaneId {
  return useUIStore.getState().centerSplitByWorktree[worktreeId]?.secondaryKeys.includes(key) ? 'secondary' : 'primary'
}

/** The view in the focused pane of the selected worktree. */
export function getFocusedView(): CenterView | null {
  const ui = useUIStore.getState()
  const wt = ui.selectedWorktreeId ?? ''
  const layout = getPaneLayout(wt)
  return layout.panes.find((p) => p.id === layout.focusedPaneId)?.view ?? null
}

export function getFocusedPaneId(): PaneId {
  const ui = useUIStore.getState()
  return ui.centerSplitByWorktree[ui.selectedWorktreeId ?? '']?.focused ?? 'primary'
}

/** The pane next to `paneId`; with `create`, returns 'secondary' even when no split exists yet. */
export function otherPaneOf(worktreeId: string, paneId: PaneId, create: boolean): PaneId | null {
  const split = useUIStore.getState().centerSplitByWorktree[worktreeId]
  if (paneId === 'primary') return split || create ? 'secondary' : null
  return 'primary'
}

/**
 * Show a tab in a pane of the selected worktree (null = the focused pane).
 * Moves the tab across panes when needed; falls back to the primary pane for
 * tabs that can't live in the secondary pane (chat sessions).
 */
export function placeTabInPane(worktreeId: string, key: string, paneId: PaneId | null): void {
  const ui = useUIStore.getState()
  if (ui.selectedWorktreeId !== worktreeId) return
  const view = keyToView(key)
  if (!view) return
  const current = paneOfKey(worktreeId, key)
  const target: PaneId = paneId ?? getFocusedPaneId()
  const effective: PaneId = target === 'secondary' && !canMoveToSecondary(key) ? 'primary' : target
  if (effective === current) {
    if (effective === 'secondary') ui.setSecondaryView(worktreeId, view)
    else {
      ui.setActiveCenterView(view)
      ui.setFocusedPane(worktreeId, 'primary')
    }
    return
  }
  ui.moveTabToPane(worktreeId, key, effective)
}

/** Activate a tab key wherever it lives (used by tab navigation and tab clicks). */
export function activateKey(key: string): void {
  const ui = useUIStore.getState()
  const wt = ui.selectedWorktreeId
  if (!wt) return
  placeTabInPane(wt, key, paneOfKey(wt, key))
}
