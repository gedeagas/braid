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
import { navigateTab, getPaneTabs, activateTab, activateTabByIndex, getActiveTabKey } from '@/lib/tabNavigation'
import { getFocusedView } from '@/lib/centerPanes'
import { getActiveBrowserTabId, newBrowserTab as openNewBrowserTab, reopenClosedBrowserTab, runBrowserAction } from '@/lib/browser/browserCommands'
import { disposeBigTerminal } from '@/components/Center/bigTerminalCache'
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
  // ⌘T inside the browser opens another browser tab (Chrome muscle memory).
  if (getActiveBrowserTabId()) { openNewBrowserTab(); return }
  const { selectedWorktreeId, selectedProjectId, setActiveCenterView } = useUIStore.getState()
  if (!selectedWorktreeId || !selectedProjectId) return
  const project = useProjectsStore.getState().projects.find((p) => p.id === selectedProjectId)
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)
  if (!worktree) return
  const sessionId = useSessionsStore.getState().createSession(selectedWorktreeId, worktree.path)
  setActiveCenterView({ type: 'session', sessionId })
}

export function newBigTerminal(): void {
  // ⌘⇧T inside the browser reopens the last closed browser tab.
  if (getActiveBrowserTabId()) { reopenClosedBrowserTab(); return }
  const ui = useUIStore.getState()
  if (!ui.selectedWorktreeId) return
  const id = ui.createBigTerminal(ui.selectedWorktreeId)
  ui.setActiveCenterView({ type: 'terminal', terminalId: id })
}

export function newBrowserTab(): void {
  openNewBrowserTab()
}

export function newClaudeCode(): void {
  const ui = useUIStore.getState()
  if (!ui.selectedWorktreeId) return
  const id = ui.createBigTerminal(ui.selectedWorktreeId, 'Claude Code', 'claude', 'claude')
  ui.setActiveCenterView({ type: 'terminal', terminalId: id })
}

/**
 * Close the currently active tab in the center panel.
 * For active sessions, prompts for confirmation before closing.
 * If no tab is active, closes the entire application window.
 */
export function closeCurrentTab(): void {
  const ui = useUIStore.getState()
  const activeKey = getActiveTabKey()

  if (!activeKey) {
    appWindow.closeWindow()
    return
  }

  // Determine adjacent tab to activate after close
  const tabs = getPaneTabs()
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
  } else if (activeKey.startsWith('t:')) {
    const terminalId = activeKey.slice(2)
    disposeBigTerminal(terminalId)
    if (ui.selectedWorktreeId) ui.closeBigTerminal(ui.selectedWorktreeId, terminalId)
  } else if (activeKey.startsWith('b:')) {
    if (ui.selectedWorktreeId) ui.closeBrowserTab(ui.selectedWorktreeId, activeKey.slice(2))
  }

  if (adjacentKey) activateTab(adjacentKey)
}

/** ⌘\ - move the focused tab to the other center pane (splitting if needed). */
export function moveTabToOtherPane(): void {
  const ui = useUIStore.getState()
  const wt = ui.selectedWorktreeId
  const key = getActiveTabKey()
  if (!wt || !key) return
  const from = ui.centerSplitByWorktree[wt]?.focused ?? 'primary'
  ui.moveTabToPane(wt, key, from === 'primary' ? 'secondary' : 'primary')
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
  // ⌘L inside the browser focuses the address bar.
  const browserTabId = getActiveBrowserTabId()
  if (browserTabId) { runBrowserAction(browserTabId, 'focusAddress'); return }
  window.dispatchEvent(new CustomEvent('braid:focusChat'))
}

export function saveFile(): void {
  if (getFocusedView()?.type === 'file') {
    window.dispatchEvent(new CustomEvent('braid:saveFile'))
  }
}
