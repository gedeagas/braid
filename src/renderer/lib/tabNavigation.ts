import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'

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
  const all = [...sessionKeys, ...fileKeys, ...changesKeys, ...terminalKeys]
  const allValid = new Set(all)
  const valid = ui.tabOrder.filter((k: string) => allValid.has(k))
  const newEntries = all.filter((k) => !valid.includes(k))
  return [...valid, ...newEntries]
}

export function getActiveTabKey(): string | null {
  const ui = useUIStore.getState()
  const wtId = ui.selectedWorktreeId ?? ''
  const acv = ui.activeCenterViewByWorktree[wtId] ?? null
  if (acv?.type === 'session') return `s:${acv.sessionId}`
  if (acv?.type === 'file') return `f:${acv.path}`
  if (acv?.type === 'changes') return 'changes'
  if (acv?.type === 'terminal') return `t:${acv.terminalId}`
  return null
}

export function activateTab(key: string): void {
  if (key.startsWith('s:')) {
    const sessionId = key.slice(2)
    useSessionsStore.getState().setActiveSession(sessionId)
    useUIStore.getState().setActiveCenterView({ type: 'session', sessionId })
  } else if (key.startsWith('f:')) {
    useUIStore.getState().setActiveCenterView({ type: 'file', path: key.slice(2) })
  } else if (key === 'changes') {
    useUIStore.getState().setActiveCenterView({ type: 'changes' })
  } else if (key.startsWith('t:')) {
    useUIStore.getState().setActiveCenterView({ type: 'terminal', terminalId: key.slice(2) })
  }
}

export function navigateTab(direction: -1 | 1): void {
  const tabs = getUnifiedTabs()
  if (tabs.length === 0) return
  const activeKey = getActiveTabKey()
  const currentIndex = activeKey ? tabs.indexOf(activeKey) : -1
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + direction + tabs.length) % tabs.length
  activateTab(tabs[nextIndex])
}

export function activateTabByIndex(n: number): void {
  const tabs = getUnifiedTabs()
  if (tabs.length === 0) return
  // ⌘9 always goes to the last tab (Chrome behavior)
  const index = n === 9 ? tabs.length - 1 : Math.min(n - 1, tabs.length - 1)
  activateTab(tabs[index])
}
