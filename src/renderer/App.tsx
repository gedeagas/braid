import { useEffect, useCallback, useRef } from 'react'
import { SIDEBAR_MIN_WIDTH, RIGHT_PANEL_MIN_WIDTH } from '@/lib/layoutConstants'
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
import { SettingsOverlay } from '@/components/Settings/SettingsOverlay'
import { ShortcutsModal } from '@/components/Shortcuts/ShortcutsModal'
import { QuickOpen } from '@/components/QuickOpen/QuickOpen'
import { CommandPalette } from '@/components/CommandPalette/CommandPalette'
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
import * as actions from '@/lib/appActions'

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

  // Apply chat density mode on mount and subscribe to changes
  useEffect(() => {
    const applyDensity = (compact: boolean) => {
      document.documentElement.setAttribute('data-density', compact ? 'compact' : 'default')
    }
    applyDensity(useUIStore.getState().chatCompactMode)
    let prev = useUIStore.getState().chatCompactMode
    const unsub = useUIStore.subscribe((state) => {
      if (state.chatCompactMode !== prev) {
        prev = state.chatCompactMode
        applyDensity(state.chatCompactMode)
      }
    })
    return unsub
  }, [])

  // Apply UI zoom on mount
  useEffect(() => {
    try { appWindow.setZoomFactor(useUIStore.getState().uiZoom) } catch {}
  }, [])

  // Re-clamp persisted panel widths on mount and window resize
  useEffect(() => {
    const reclamp = () => useUIStore.getState().reclampPanelWidths()
    reclamp() // initial clamp in case persisted widths exceed current viewport
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
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

  // Listen for menu actions from Electron application menu.
  // Action implementations live in `@/lib/appActions` so they can be shared
  // between the Electron menu (here) and the Command Palette UI.
  useEffect(() => {
    const menuActions: Record<string, () => void> = {
      openSettings: actions.openSettings,
      openAbout: actions.openAbout,
      openShortcuts: actions.openShortcuts,
      openCommandPalette: actions.openCommandPalette,
      toggleSidebar: actions.toggleSidebar,
      toggleRightPanel: actions.toggleRightPanel,
      toggleMissionControl: actions.toggleMissionControl,
      toggleTerminal: actions.toggleTerminal,
      zoomIn: actions.zoomIn,
      zoomOut: actions.zoomOut,
      zoomReset: actions.zoomReset,
      newChatTab: actions.newChatTab,
      newBigTerminal: actions.newBigTerminal,
      closeCurrentTab: actions.closeCurrentTab,
      previousTab: actions.previousTab,
      nextTab: actions.nextTab,
      focusChat: actions.focusChat,
      quickOpen: actions.openQuickOpen,
      saveFile: actions.saveFile,
    }

    // ⌘1-9: jump to tab by index (⌘9 always goes to last tab)
    for (let i = 1; i <= 9; i++) {
      menuActions[`goToTab${i}`] = () => actions.goToTab(i)
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
        <div className="sidebar-panel" style={{ width: sidebarPanelOpen ? sidebarWidth : 0, minWidth: sidebarPanelOpen ? SIDEBAR_MIN_WIDTH : 0 }}>
          <SidebarView />
        </div>
        {sidebarPanelOpen && <ResizeHandle direction="horizontal" onResize={handleSidebarResize} onResizeEnd={persistSidebarWidth} />}
        {/* Hide center+right when Mission Control or web app is active, but keep mounted */}
        <div style={{ display: (missionControlActive || webAppActive) ? 'none' : 'contents' }}>
          <CenterPanel />
          {rightPanelVisible && <ResizeHandle direction="horizontal" onResize={handleRightResize} onResizeEnd={persistRightWidth} />}
          <div className="right-panel" style={{ width: rightPanelVisible ? rightWidth : 0, minWidth: rightPanelVisible ? RIGHT_PANEL_MIN_WIDTH : 0 }}>
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
      <CommandPalette />
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
