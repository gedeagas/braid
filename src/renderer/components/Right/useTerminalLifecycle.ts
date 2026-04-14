import { useEffect, useCallback, type MutableRefObject } from 'react'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/store/ui'
import {
  SETUP_TAB_ID,
  terminalCache, nextTabId, createTerminal, initGlobalPtyRouting, reThemeAllTerminals,
  type TermTab,
} from './terminalCache'

interface LifecycleArgs {
  worktreePath: string
  collapsed?: boolean
  hidden?: boolean
  onToggleCollapse?: () => void
  worktreePathRef: MutableRefObject<string>
  tabsRef: MutableRefObject<TermTab[]>
  activeTabIdRef: MutableRefObject<string | null>
  containerRefs: MutableRefObject<Map<string, HTMLDivElement>>
  pendingAttach: MutableRefObject<Map<string, TermTab>>
  pendingCommandRef: MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<TermTab[]>>
  setActiveTabId: React.Dispatch<React.SetStateAction<string | null>>
  addTab: () => void
  attachTerm: (tab: TermTab, el: HTMLDivElement) => void
  setupResizeObserver: (tab: TermTab, el: HTMLDivElement) => void
}

export function useTerminalLifecycle({
  worktreePath, collapsed, hidden, onToggleCollapse,
  worktreePathRef, tabsRef, activeTabIdRef, containerRefs, pendingAttach, pendingCommandRef,
  setTabs, setActiveTabId, addTab, attachTerm, setupResizeObserver,
}: LifecycleArgs): void {

  // ── Initialize global PTY routing once ────────────────────────────────────
  useEffect(() => { initGlobalPtyRouting() }, [])

  // ── Re-theme terminals when app theme changes ────────────────────────────
  useEffect(() => {
    let prevId = useUIStore.getState().activeThemeId
    const unsub = useUIStore.subscribe((state) => {
      if (state.activeThemeId !== prevId) {
        prevId = state.activeThemeId
        requestAnimationFrame(() => reThemeAllTerminals())
      }
    })
    return unsub
  }, [])

  // ── Update terminal font size when setting changes ───────────────────────
  useEffect(() => {
    let prevSize = useUIStore.getState().terminalFontSize
    const unsub = useUIStore.subscribe((state) => {
      if (state.terminalFontSize !== prevSize) {
        prevSize = state.terminalFontSize
        for (const cached of terminalCache.values()) {
          for (const tab of cached.tabs) {
            tab.term.options.fontSize = prevSize
            try { tab.fitAddon.fit() } catch { /* ignore */ }
          }
        }
      }
    })
    return unsub
  }, [])

  // ── Consume pending terminal command (run scripts) ───────────────────────
  useEffect(() => {
    const unsub = useUIStore.subscribe((state, prev) => {
      if (state.pendingTerminalCommand && !prev.pendingTerminalCommand) {
        const cmd = state.pendingTerminalCommand
        if (cmd.worktreePath === worktreePathRef.current) {
          pendingCommandRef.current = cmd.command
          const tabId = nextTabId()
          const { term, fitAddon } = createTerminal()
          const newTab: TermTab = { id: tabId, label: cmd.label, ptyId: null, term, fitAddon, resizeObserver: null }

          setTabs((prev) => { const next = [...prev, newTab]; tabsRef.current = next; return next })
          setActiveTabId(tabId)
          activeTabIdRef.current = tabId

          const cached = terminalCache.get(worktreePathRef.current)
          if (cached) {
            cached.tabs = [...cached.tabs, newTab]
            cached.activeTabId = tabId
          } else {
            terminalCache.set(worktreePathRef.current, { tabs: [newTab], activeTabId: tabId })
          }

          pendingAttach.current.set(tabId, newTab)
          useUIStore.getState().setPendingTerminalCommand(null)
        }
      }
    })
    return unsub
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-switch to Setup tab when a setup run is pending ─────────────────
  useEffect(() => {
    const unsub = useUIStore.subscribe((state, prev) => {
      if (state.pendingSetupRun && !prev.pendingSetupRun) {
        if (state.pendingSetupRun.worktreePath === worktreePathRef.current) {
          setActiveTabId(SETUP_TAB_ID)
          activeTabIdRef.current = SETUP_TAB_ID
          if (collapsed && onToggleCollapse) onToggleCollapse()
        }
      }
    })
    return unsub
  }, [collapsed, onToggleCollapse, setActiveTabId, activeTabIdRef])

  // ── Shared helper: disconnect observers and save to cache ───────────────
  const saveToCacheFor = useCallback((path: string) => {
    const currentTabs = tabsRef.current
    for (const tab of currentTabs) {
      tab.resizeObserver?.disconnect()
      tab.resizeObserver = null
    }
    terminalCache.set(path, { tabs: currentTabs, activeTabId: activeTabIdRef.current })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lifecycle: worktree switch ───────────────────────────────────────────
  useEffect(() => {
    const cached = terminalCache.get(worktreePath)
    if (cached && cached.tabs.length > 0) {
      const restoredTabs = cached.tabs
      const restoredActive = cached.activeTabId ?? restoredTabs[0]?.id ?? null
      setTabs(restoredTabs)
      tabsRef.current = restoredTabs
      setActiveTabId(restoredActive)
      activeTabIdRef.current = restoredActive
      requestAnimationFrame(() => {
        for (const tab of restoredTabs) {
          const el = containerRefs.current.get(tab.id)
          if (el && tab.term.element) {
            el.appendChild(tab.term.element)
            setupResizeObserver(tab, el)
          }
        }
        const activeTab = restoredTabs.find((t) => t.id === restoredActive)
        if (activeTab) {
          requestAnimationFrame(() => {
            try {
              activeTab.fitAddon.fit()
              if (activeTab.ptyId) ipc.pty.resize(activeTab.ptyId, activeTab.term.cols, activeTab.term.rows)
            } catch { /* ignore */ }
          })
        }
      })
    } else {
      setTabs([])
      tabsRef.current = []
      setActiveTabId(null)
      activeTabIdRef.current = null
      addTab()
    }
    // Capture worktreePath in closure — cleanup runs after the next render
    // has already updated worktreePathRef, so we need the closed-over value
    return () => saveToCacheFor(worktreePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreePath])

  // ── On unmount: save to cache but keep everything alive ──────────────────
  useEffect(() => () => saveToCacheFor(worktreePathRef.current), []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fit active terminal when hidden changes ──────────────────────────────
  useEffect(() => {
    if (hidden) return
    requestAnimationFrame(() => {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
      if (tab) {
        const el = containerRefs.current.get(tab.id)
        if (el && tab.term.element && !el.contains(tab.term.element)) {
          el.appendChild(tab.term.element)
        }
        try {
          tab.fitAddon.fit()
          if (tab.ptyId) ipc.pty.resize(tab.ptyId, tab.term.cols, tab.term.rows)
        } catch { /* ignore */ }
      }
    })
  }, [hidden]) // eslint-disable-line react-hooks/exhaustive-deps
}
