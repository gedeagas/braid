/**
 * Shared application actions.
 *
 * This module centralizes the imperative logic for app-level actions
 * (tab management, panel toggles, zoom controls, etc.) so that the same
 * behavior can be triggered from multiple surfaces - the Electron menu
 * accelerators in `App.tsx` and the Command Palette in `CommandPalette.tsx`.
 *
 * Keep handlers pure and side-effect-based: each one reads fresh store
 * state via `getState()` and mutates via store actions. Never capture store
 * values in closures here - that would create stale-capture bugs.
 */

import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'
import { useProjectsStore } from '@/store/projects'
import { navigateTab, getUnifiedTabs, activateTab, activateTabByIndex } from '@/lib/tabNavigation'
import i18n from '@/lib/i18n'
import { appWindow } from '@/lib/ipc'

// ─── Settings / overlays ─────────────────────────────────────────────────────

export function openSettings(): void {
  useUIStore.getState().openSettings()
}

export function openAbout(): void {
  useUIStore.getState().openSettings('about')
}

export function openShortcuts(): void {
  useUIStore.getState().openShortcuts()
}

export function openCommandPalette(): void {
  useUIStore.getState().openCommandPalette()
}

export function openQuickOpen(): void {
  useUIStore.getState().openQuickOpen()
}

// ─── Layout toggles ──────────────────────────────────────────────────────────

export function toggleSidebar(): void {
  useUIStore.getState().toggleSidebar()
}

export function toggleRightPanel(): void {
  useUIStore.getState().toggleRightPanel()
}

export function toggleMissionControl(): void {
  useUIStore.getState().toggleMissionControl()
}

export function toggleTerminal(): void {
  const { bottomTerminalEnabled, setBottomTerminalEnabled } = useUIStore.getState()
  setBottomTerminalEnabled(!bottomTerminalEnabled)
}

// ─── Zoom ────────────────────────────────────────────────────────────────────

export function zoomIn(): void {
  const { uiZoom, setUIZoom } = useUIStore.getState()
  setUIZoom(uiZoom + 0.1)
}

export function zoomOut(): void {
  const { uiZoom, setUIZoom } = useUIStore.getState()
  setUIZoom(uiZoom - 0.1)
}

export function zoomReset(): void {
  useUIStore.getState().setUIZoom(1.0)
}

// ─── Tab management ──────────────────────────────────────────────────────────

export function newChatTab(): void {
  const { selectedWorktreeId, selectedProjectId, setActiveCenterView } = useUIStore.getState()
  if (!selectedWorktreeId || !selectedProjectId) return
  const project = useProjectsStore.getState().projects.find((p) => p.id === selectedProjectId)
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)
  if (!worktree) return
  const sessionId = useSessionsStore.getState().createSession(selectedWorktreeId, worktree.path)
  setActiveCenterView({ type: 'session', sessionId })
}

/**
 * Close the currently active tab in the center panel.
 * For active sessions, prompts for confirmation before closing.
 * If no tab is active, closes the entire application window.
 */
export function closeCurrentTab(): void {
  const ui = useUIStore.getState()
  const wtId = ui.selectedWorktreeId ?? ''
  const acv = ui.activeCenterViewByWorktree[wtId] ?? null

  let activeKey: string | null = null
  if (acv?.type === 'session') activeKey = `s:${acv.sessionId}`
  else if (acv?.type === 'file') activeKey = `f:${acv.path}`
  else if (acv?.type === 'changes') activeKey = 'changes'

  if (!activeKey) {
    appWindow.closeWindow()
    return
  }

  // Determine adjacent tab to activate after close
  const tabs = getUnifiedTabs()
  const closingIndex = tabs.indexOf(activeKey)
  const adjacentKey = closingIndex >= 0
    ? tabs[closingIndex + 1] ?? tabs[closingIndex - 1] ?? null
    : null

  if (activeKey.startsWith('s:')) {
    const sid = activeKey.slice(2)
    const session = useSessionsStore.getState().sessions[sid]
    if (session && session.status !== 'idle' && session.status !== 'inactive') {
      const title = i18n.t('closeActiveSessionTitle', { ns: 'center' })
      const msg = i18n.t('closeActiveSessionMessage', { ns: 'center', status: session.status })
      if (!window.confirm(`${title}\n\n${msg}`)) return
    }
    useSessionsStore.getState().closeSession(sid)
  } else if (activeKey.startsWith('f:')) {
    ui.closeFile(activeKey.slice(2))
  } else if (activeKey === 'changes') {
    ui.closeChanges()
  }

  if (adjacentKey) activateTab(adjacentKey)
}

export function previousTab(): void {
  navigateTab(-1)
}

export function nextTab(): void {
  navigateTab(1)
}

export function goToTab(n: number): void {
  activateTabByIndex(n)
}

// ─── Focus / Save ────────────────────────────────────────────────────────────

export function focusChat(): void {
  window.dispatchEvent(new CustomEvent('braid:focusChat'))
}

export function saveFile(): void {
  const wtId = useUIStore.getState().selectedWorktreeId ?? ''
  const acv = useUIStore.getState().activeCenterViewByWorktree[wtId] ?? null
  if (acv?.type === 'file') {
    window.dispatchEvent(new CustomEvent('braid:saveFile'))
  }
}
