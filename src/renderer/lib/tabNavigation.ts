import { useUIStore, centerViewToTabKey, type PaneId } from '@/store/ui'
import { activateKey, getFocusedPaneId, getFocusedView } from '@/lib/centerPanes'
import { useSessionsStore } from '@/store/sessions'

/** Tab keys of one pane, in tab-bar order (the focused pane by default). */
export function getPaneTabs(pane: PaneId = getFocusedPaneId()): string[] {
  const ui = useUIStore.getState()
  const secondary = ui.centerSplitByWorktree[ui.selectedWorktreeId ?? '']?.secondaryKeys ?? []
  if (pane === 'secondary') return secondary
  return getUnifiedTabs().filter((k) => !secondary.includes(k))
}

/** Build the unified tab list matching SessionTabBar's reconciliation logic */
export function getUnifiedTabs(): string[] {
  const ui = useUIStore.getState()
  const wtId = ui.selectedWorktreeId ?? ''
  const sessions = Object.values(useSessionsStore.getState().sessions)
    .filter((s) => s.worktreeId === ui.selectedWorktreeId)
  const sessionKeys = sessions.map((s) => `s:${s.id}`)
  const fileKeys = ui.openFilePaths.map((p: string) => `f:${p}`)
  const changesOpen = ui.changesOpenByWorktree[wtId] ?? false
  const changesKeys = changesOpen ? ['changes'] : []
  const terminalKeys = (ui.bigTerminalsByWorktree[wtId] ?? []).map((bt) => `t:${bt.id}`)
  const browserKeys = (ui.browserTabsByWorktree[wtId] ?? []).map((bw) => `b:${bw.id}`)
  const all = [...sessionKeys, ...fileKeys, ...changesKeys, ...terminalKeys, ...browserKeys]
  const allValid = new Set(all)
  const valid = ui.tabOrder.filter((k: string) => allValid.has(k))
  const newEntries = all.filter((k) => !valid.includes(k))
  return [...valid, ...newEntries]
}

export { centerViewToTabKey }

/** Key of the tab shown in the focused pane. */
export function getActiveTabKey(): string | null {
  return centerViewToTabKey(getFocusedView())
}

export function activateTab(key: string): void {
  if (key.startsWith('s:')) useSessionsStore.getState().setActiveSession(key.slice(2))
  activateKey(key)
}

export function navigateTab(direction: -1 | 1): void {
  const tabs = getPaneTabs()
  if (tabs.length === 0) return
  const activeKey = getActiveTabKey()
  const currentIndex = activeKey ? tabs.indexOf(activeKey) : -1
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + direction + tabs.length) % tabs.length
  activateTab(tabs[nextIndex])
}

export function activateTabByIndex(n: number): void {
  const tabs = getPaneTabs()
  if (tabs.length === 0) return
  // ⌘9 always goes to the last tab (Chrome behavior)
  const index = n === 9 ? tabs.length - 1 : Math.min(n - 1, tabs.length - 1)
  activateTab(tabs[index])
}
