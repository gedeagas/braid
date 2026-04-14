import { useEffect, useCallback, useRef } from 'react'
import { ActivityBar } from '@/components/Sidebar/ActivityBar'
import { SidebarView } from '@/components/Sidebar/SidebarView'
import { CenterPanel } from '@/components/Center/CenterPanel'
import { RightPanel } from '@/components/Right/RightPanel'
import { ResizeHandle } from '@/components/shared/ResizeHandle'
import { useProjectsStore } from '@/store/projects'
import { initAgentEventListener, useSessionsStore } from '@/store/sessions'
import { useUIStore } from '@/store/ui'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { applyTheme } from '@/themes/apply'
import { findTheme, builtinThemes } from '@/themes/palettes'
import { settings, appWindow, dock } from '@/lib/ipc'
import i18n from '@/lib/i18n'
import { SettingsOverlay } from '@/components/Settings/SettingsOverlay'
import { ShortcutsModal } from '@/components/Shortcuts/ShortcutsModal'
import { QuickOpen } from '@/components/QuickOpen/QuickOpen'
import { MissionControl } from '@/components/MissionControl/MissionControl'
import { WebAppOverlay } from '@/components/Center/WebAppOverlay'
import { ToastContainer } from '@/components/shared/ToastContainer'
import { FlashToastContainer } from '@/components/shared/FlashToastContainer'
import { OnboardingOverlay } from '@/components/Onboarding/OnboardingOverlay'
import { FeatureTour } from '@/components/Onboarding/FeatureTour'
import { SimulatorTour } from '@/components/Onboarding/SimulatorTour'
import { UpdateDialog } from '@/components/shared/UpdateDialog'
import { useAutoUpdate } from '@/hooks/useAutoUpdate'
import { initUpdateListeners } from '@/store/updater'

/** Build the unified tab list matching SessionTabBar's reconciliation logic */
function getUnifiedTabs(): string[] {
  const ui = useUIStore.getState()
  const wtId = ui.selectedWorktreeId ?? ''
  const sessions = Object.values(useSessionsStore.getState().sessions)
    .filter((s) => s.worktreeId === ui.selectedWorktreeId)
  const sessionKeys = sessions.map((s) => `s:${s.id}`)
  const fileKeys = ui.openFilePaths.map((p: string) => `f:${p}`)
  const changesOpen = ui.changesOpenByWorktree[wtId] ?? false
  const changesKeys = changesOpen ? ['changes'] : []
  const allValid = new Set([...sessionKeys, ...fileKeys, ...changesKeys])
  const valid = ui.tabOrder.filter((k: string) => allValid.has(k))
  const newEntries = [...sessionKeys, ...fileKeys, ...changesKeys].filter((k) => !valid.includes(k))
  return [...valid, ...newEntries]
}

function getActiveTabKey(): string | null {
  const ui = useUIStore.getState()
  const wtId = ui.selectedWorktreeId ?? ''
  const acv = ui.activeCenterViewByWorktree[wtId] ?? null
  if (acv?.type === 'session') return `s:${acv.sessionId}`
  if (acv?.type === 'file') return `f:${acv.path}`
  if (acv?.type === 'changes') return 'changes'
  return null
}

function activateTab(key: string): void {
  if (key.startsWith('s:')) {
    const sessionId = key.slice(2)
    useSessionsStore.getState().setActiveSession(sessionId)
    useUIStore.getState().setActiveCenterView({ type: 'session', sessionId })
  } else if (key.startsWith('f:')) {
    useUIStore.getState().setActiveCenterView({ type: 'file', path: key.slice(2) })
  } else if (key === 'changes') {
    useUIStore.getState().setActiveCenterView({ type: 'changes' })
  }
}

function navigateTab(direction: -1 | 1): void {
  const tabs = getUnifiedTabs()
  if (tabs.length === 0) return
  const activeKey = getActiveTabKey()
  const currentIndex = activeKey ? tabs.indexOf(activeKey) : -1
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + direction + tabs.length) % tabs.length
  activateTab(tabs[nextIndex])
}

function activateTabByIndex(n: number): void {
  const tabs = getUnifiedTabs()
  if (tabs.length === 0) return
  // ⌘9 always goes to the last tab (Chrome behavior)
  const index = n === 9 ? tabs.length - 1 : Math.min(n - 1, tabs.length - 1)
  activateTab(tabs[index])
}

export default function App() {
  const autoUpdate = useAutoUpdate()
  const loadProjects = useProjectsStore((s) => s.loadProjects)
  const loadPersistedSessions = useSessionsStore((s) => s.loadPersistedSessions)
  const missionControlActive = useUIStore((s) => s.missionControlActive)
  const mcEverOpened = useRef(false)
  if (missionControlActive) mcEverOpened.current = true
  const activeWebAppId = useUIStore((s) => s.activeWebAppId)
  const webAppsEnabled = useUIStore((s) => s.webAppsEnabled)
  const webAppActive = webAppsEnabled && !!activeWebAppId
  const sidebarPanelOpen = useUIStore((s) => s.sidebarPanelOpen)
  const rightPanelVisible = useUIStore((s) => s.rightPanelVisible)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const rightWidth = useUIStore((s) => s.rightPanelWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const persistSidebarWidth = useUIStore((s) => s.persistSidebarWidth)
  const setRightWidth = useUIStore((s) => s.setRightPanelWidth)
  const persistRightWidth = useUIStore((s) => s.persistRightPanelWidth)

  // Apply theme on mount and subscribe to changes
  useEffect(() => {
    const apply = () => {
      const { activeThemeId, customThemes } = useUIStore.getState()
      const palette = findTheme(activeThemeId, customThemes) ?? builtinThemes[0]
      applyTheme(palette)
    }
    apply()
    let prevId = useUIStore.getState().activeThemeId
    const unsub = useUIStore.subscribe((state) => {
      if (state.activeThemeId !== prevId) {
        prevId = state.activeThemeId
        apply()
      }
    })
    return unsub
  }, [])

  // Apply UI zoom on mount
  useEffect(() => {
    try { appWindow.setZoomFactor(useUIStore.getState().uiZoom) } catch {}
  }, [])

  useEffect(() => {
    console.log('[Braid] App mounted')
    loadProjects()
      .then(() => console.log('[Braid] Projects loaded'))
      .catch((e) => console.error('[Braid] Failed to load projects:', e))
    loadPersistedSessions()
      .then(() => {
        console.log('[Braid] Persisted sessions loaded')
        // Set initial badge from any persisted sessions already in waiting_input
        const count = Object.values(useSessionsStore.getState().sessions)
          .filter(s => s.status === 'waiting_input').length
        dock.setBadgeCount(count)
      })
      .catch((e) => console.error('[Braid] Failed to load sessions:', e))

    // Push initial settings to main process and keep in sync
    const syncSettings = () => {
      const state = useUIStore.getState()
      settings.sync({
        apiKey: state.apiKey,
        systemPromptSuffix: state.systemPromptSuffix,
        claudeCodeExecutablePath: state.claudeCodeExecutablePath,
        terminalShell: state.terminalShell,
        worktreeStoragePath: state.worktreeStoragePath,
        notifyOnDone: state.notifyOnDone,
        notifyOnError: state.notifyOnError,
        notifyOnWaitingInput: state.notifyOnWaitingInput,
        notificationSound: state.notificationSound,
        bypassPermissions: state.bypassPermissions,
      }).catch((e: unknown) => console.error('[Braid] Failed to sync settings:', e))
    }
    syncSettings()
    const unsubSettings = useUIStore.subscribe(syncSettings)

    const cleanup = initAgentEventListener()
    const cleanupUpdater = initUpdateListeners()

    // Keep dock badge in sync with sessions needing attention
    const unsubBadge = useSessionsStore.subscribe((state, prevState) => {
      const count = Object.values(state.sessions).filter(s => s.status === 'waiting_input').length
      const prevCount = Object.values(prevState.sessions).filter(s => s.status === 'waiting_input').length
      if (count !== prevCount) {
        dock.setBadgeCount(count)
      }
    })

    return () => {
      cleanup()
      unsubSettings()
      cleanupUpdater()
      unsubBadge()
    }
  }, [loadProjects, loadPersistedSessions])

  // Listen for menu actions from Electron application menu
  useEffect(() => {
    const menuActions: Record<string, () => void> = {
      openSettings: () => useUIStore.getState().openSettings(),
      openAbout: () => useUIStore.getState().openSettings('about'),
      openShortcuts: () => useUIStore.getState().openShortcuts(),
      toggleSidebar: () => useUIStore.getState().toggleSidebar(),
      toggleRightPanel: () => useUIStore.getState().toggleRightPanel(),
      toggleMissionControl: () => useUIStore.getState().toggleMissionControl(),
      zoomIn: () => {
        const { uiZoom, setUIZoom } = useUIStore.getState()
        setUIZoom(uiZoom + 0.1)
      },
      zoomOut: () => {
        const { uiZoom, setUIZoom } = useUIStore.getState()
        setUIZoom(uiZoom - 0.1)
      },
      zoomReset: () => useUIStore.getState().setUIZoom(1.0),

      // ── Tab management ──────────────────────────────────────────────
      newChatTab: () => {
        const { selectedWorktreeId, selectedProjectId, setActiveCenterView } = useUIStore.getState()
        if (!selectedWorktreeId || !selectedProjectId) return
        const project = useProjectsStore.getState().projects.find((p) => p.id === selectedProjectId)
        const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)
        if (!worktree) return
        const sessionId = useSessionsStore.getState().createSession(selectedWorktreeId, worktree.path)
        setActiveCenterView({ type: 'session', sessionId })
      },

      closeCurrentTab: () => {
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

        // Navigate to adjacent tab (or close window if none remain)
        if (adjacentKey) {
          activateTab(adjacentKey)
        }
      },

      previousTab: () => navigateTab(-1),
      nextTab: () => navigateTab(1),

      // ── Toggle terminal ─────────────────────────────────────────────
      toggleTerminal: () => {
        const { bottomTerminalEnabled, setBottomTerminalEnabled } = useUIStore.getState()
        setBottomTerminalEnabled(!bottomTerminalEnabled)
      },

      // ── Focus / Save ────────────────────────────────────────────────
      focusChat: () => {
        window.dispatchEvent(new CustomEvent('braid:focusChat'))
      },
      quickOpen: () => useUIStore.getState().openQuickOpen(),
      saveFile: () => {
        const wtId = useUIStore.getState().selectedWorktreeId ?? ''
        const acv = useUIStore.getState().activeCenterViewByWorktree[wtId] ?? null
        if (acv?.type === 'file') {
          window.dispatchEvent(new CustomEvent('braid:saveFile'))
        }
      },
    }

    // ⌘1-9: jump to tab by index (⌘9 always goes to last tab)
    for (let i = 1; i <= 9; i++) {
      menuActions[`goToTab${i}`] = () => activateTabByIndex(i)
    }

    return window.api.menu.onAction((action: string) => menuActions[action]?.())
  }, [])

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(useUIStore.getState().sidebarWidth + delta)
  }, [setSidebarWidth])

  const handleRightResize = useCallback((delta: number) => {
    // Negative delta = dragging left = panel gets wider
    setRightWidth(useUIStore.getState().rightPanelWidth - delta)
  }, [setRightWidth])

  return (
    <ErrorBoundary>
      <div className="app">
        <ActivityBar />
        <div className="sidebar-panel" style={{ width: sidebarPanelOpen ? sidebarWidth : 0 }}>
          <SidebarView />
        </div>
        {sidebarPanelOpen && <ResizeHandle direction="horizontal" onResize={handleSidebarResize} onResizeEnd={persistSidebarWidth} />}
        {/* Hide center+right when Mission Control or web app is active, but keep mounted */}
        <div style={{ display: (missionControlActive || webAppActive) ? 'none' : 'contents' }}>
          <CenterPanel />
          {rightPanelVisible && <ResizeHandle direction="horizontal" onResize={handleRightResize} onResizeEnd={persistRightWidth} />}
          <div className="right-panel" style={{ width: rightPanelVisible ? rightWidth : 0 }}>
            <RightPanel />
          </div>
        </div>
        {mcEverOpened.current && (
          <div style={{ display: missionControlActive ? 'contents' : 'none' }}>
            <MissionControl />
          </div>
        )}
        {webAppsEnabled && (
          <div style={{ display: !missionControlActive && webAppActive ? 'contents' : 'none' }}>
            <WebAppOverlay />
          </div>
        )}
      </div>
      <SettingsOverlay />
      <ShortcutsModal />
      <QuickOpen />
      <ToastContainer />
      <FlashToastContainer />
      <UpdateDialog
        state={autoUpdate.state}
        onDownload={autoUpdate.download}
        onInstall={autoUpdate.install}
        onDismiss={autoUpdate.dismiss}
        onRetry={autoUpdate.retry}
      />
      <OnboardingOverlay />
      <FeatureTour />
      <SimulatorTour />
    </ErrorBoundary>
  )
}
