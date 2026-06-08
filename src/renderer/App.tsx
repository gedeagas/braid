import { useEffect, useCallback, useRef } from 'react'
import { SIDEBAR_MIN_WIDTH, RIGHT_PANEL_MIN_WIDTH } from '@/lib/layoutConstants'
import { ActivityBar } from '@/components/Sidebar/ActivityBar'
import { SidebarView } from '@/components/Sidebar/SidebarView'
import { CenterPanel } from '@/components/Center/CenterPanel'
import { RightPanel } from '@/components/Right/RightPanel'
import { ResizeHandle } from '@/components/shared/ResizeHandle'
import { useProjectsStore } from '@/store/projects'
import { initAgentEventListener, useSessionsStore } from '@/store/sessions'
import { useUIStore, selectActiveCenterView } from '@/store/ui'
import { syncAllPersistedBigTerminalMetadata } from '@/store/ui/terminals'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { applyTheme } from '@/themes/apply'
import { findTheme, builtinThemes } from '@/themes/palettes'
import { settings, appWindow, dock, mobile } from '@/lib/ipc'
import { SettingsOverlay } from '@/components/Settings/SettingsOverlay'
import { ShortcutsModal } from '@/components/Shortcuts/ShortcutsModal'
import { QuickOpen } from '@/components/QuickOpen/QuickOpen'
import { CommandPalette } from '@/components/CommandPalette/CommandPalette'
import { MissionControl } from '@/components/MissionControl/MissionControl'
import { TasksView } from '@/components/Tasks/TasksView'
import { MobilePairingView } from '@/components/MobilePairing/MobilePairingView'
import { WebAppOverlay } from '@/components/Center/WebAppOverlay'
import { ToastContainer } from '@/components/shared/ToastContainer'
import { FlashToastContainer } from '@/components/shared/FlashToastContainer'
import { OnboardingOverlay } from '@/components/Onboarding/OnboardingOverlay'
import { FeatureTour } from '@/components/Onboarding/FeatureTour'
import { SimulatorTour } from '@/components/Onboarding/SimulatorTour'
import { UpdateDialog } from '@/components/shared/UpdateDialog'
import { AdminInstallDialog } from '@/components/shared/AdminInstallDialog'
import { useAutoUpdate } from '@/hooks/useAutoUpdate'
import { initUpdateListeners } from '@/store/updater'
import * as actions from '@/lib/appActions'
import { initAgentDetection } from '@/lib/agentDetection'
import { UsageStatusBar } from '@/components/StatusBar/UsageStatusBar'

export default function App() {
  const autoUpdate = useAutoUpdate()
  const loadProjects = useProjectsStore((s) => s.loadProjects)
  const loadPersistedSessions = useSessionsStore((s) => s.loadPersistedSessions)
  const missionControlActive = useUIStore((s) => s.missionControlActive)
  const mcEverOpened = useRef(false)
  if (missionControlActive) mcEverOpened.current = true
  const tasksActive = useUIStore((s) => s.tasksActive)
  const tasksEverOpened = useRef(false)
  if (tasksActive) tasksEverOpened.current = true
  const mobilePairingActive = useUIStore((s) => s.mobilePairingActive)
  const mobilePairingEverOpened = useRef(false)
  if (mobilePairingActive) mobilePairingEverOpened.current = true
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
    // Push every persisted big-terminal label to the daemon so the mobile app
    // (and cold-start hydrate) can name terminals in worktrees the user hasn't
    // re-selected this session - loadInitial() hydrates state without syncing.
    syncAllPersistedBigTerminalMetadata()
    loadProjects()
      .then(() => console.log('[Braid] Projects loaded'))
      .catch((e) => console.error('[Braid] Failed to load projects:', e))
    loadPersistedSessions()
      .then(() => {
        console.log('[Braid] Persisted sessions loaded')
        // Set initial badge from sessions + big terminal agents needing attention
        const sessionCount = Object.values(useSessionsStore.getState().sessions)
          .filter(s => s.status === 'waiting_input').length
        const terminalCount = Object.values(useUIStore.getState().bigTerminalStatusById)
          .filter(e => e.state === 'waiting' || e.state === 'blocked').length
        dock.setBadgeCount(sessionCount + terminalCount)
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
        terminalScrollback: state.terminalScrollback,
        worktreeStoragePath: state.worktreeStoragePath,
        notifyOnDone: state.notifyOnDone,
        notifyOnError: state.notifyOnError,
        notifyOnWaitingInput: state.notifyOnWaitingInput,
        notificationSound: state.notificationSound,
        bypassPermissions: state.bypassPermissions,
        mobileNgrokRegion: state.mobileNgrokRegion,
        keepAwakeWhileAgentsRun: state.keepAwakeWhileAgentsRun,
      }).catch((e: unknown) => console.error('[Braid] Failed to sync settings:', e))
    }
    syncSettings()
    const unsubSettings = useUIStore.subscribe(syncSettings)

    // Restore the mobile companion server if it was enabled before restart.
    if (useUIStore.getState().mobileServerEnabled) {
      mobile.start().catch((e: unknown) => console.error('[Braid] Failed to restore mobile server:', e))
    }

    const cleanup = initAgentEventListener()
    const cleanupUpdater = initUpdateListeners()
    const cleanupAgentDetection = initAgentDetection()
    const unsubRemoteBigTerminal = window.api.pty.onBigTerminalRegistered((tab: { terminalId: string; worktreeId?: string; worktreePath?: string; label?: string; agentId?: string }) => {
      // Resolve the worktree id: trust the broadcast, else map the path against
      // the renderer's own worktrees (covers deep-link worktrees the main
      // process registry didn't have an id for).
      let worktreeId = tab.worktreeId
      if (!worktreeId && tab.worktreePath) {
        for (const project of useProjectsStore.getState().projects) {
          const match = project.worktrees.find((w) => w.path === tab.worktreePath)
          if (match) { worktreeId = match.id; break }
        }
      }
      if (!worktreeId) return
      useUIStore.getState().registerRemoteBigTerminal(worktreeId, {
        id: tab.terminalId,
        label: tab.label ?? 'Terminal',
        agentId: tab.agentId,
      })
    })

    // Resolve a broadcast's worktree id: trust the payload, else map its path
    // against the renderer's own worktrees (deep-link worktrees may lack an id).
    const resolveWorktreeId = (tab: { worktreeId?: string; worktreePath?: string }): string | undefined => {
      if (tab.worktreeId) return tab.worktreeId
      if (!tab.worktreePath) return undefined
      for (const project of useProjectsStore.getState().projects) {
        const match = project.worktrees.find((w) => w.path === tab.worktreePath)
        if (match) return match.id
      }
      return undefined
    }

    // Live-sync big-terminal tab renames/closes initiated on another desktop
    // window or a paired mobile device.
    const unsubBigTerminalRenamed = window.api.pty.onBigTerminalRenamed((tab: { terminalId: string; worktreeId?: string; worktreePath?: string; label: string }) => {
      const worktreeId = resolveWorktreeId(tab)
      if (!worktreeId) return
      useUIStore.getState().applyRemoteBigTerminalRename(worktreeId, tab.terminalId, tab.label)
    })
    const unsubBigTerminalClosed = window.api.pty.onBigTerminalClosed((tab: { terminalId: string; worktreeId?: string; worktreePath?: string }) => {
      const worktreeId = resolveWorktreeId(tab)
      if (!worktreeId) return
      useUIStore.getState().removeRemoteBigTerminal(worktreeId, tab.terminalId)
    })

    // A paired mobile device requested a worktree removal. Run the SAME teardown
    // the desktop "Remove" button does (archive script, terminal/PTY disposal,
    // session cascade-delete, UI/localStorage cleanup, git remove) so a mobile
    // removal isn't a bare git op that leaves orphaned state behind. Resolve the
    // project + worktree from the paths and ack the result so main can fall back
    // to a direct git remove if we don't know the worktree.
    const unsubMobileRemoveWorktree = mobile.onRemoveWorktreeRequest(async ({ requestId, repoPath, worktreePath }) => {
      try {
        const projects = useProjectsStore.getState().projects
        const project =
          projects.find((p) => p.path === repoPath) ??
          projects.find((p) => p.worktrees.some((w) => w.path === worktreePath))
        const worktree = project?.worktrees.find((w) => w.path === worktreePath)
        if (!project || !worktree) {
          mobile.sendRemoveWorktreeResult({ requestId, ok: false, reason: 'not_found' })
          return
        }
        await useProjectsStore.getState().removeWorktree(project.id, worktree.id)
        mobile.sendRemoveWorktreeResult({ requestId, ok: true })
      } catch (err) {
        console.error('[Braid] mobile removeWorktree failed:', err)
        mobile.sendRemoveWorktreeResult({
          requestId,
          ok: false,
          reason: err instanceof Error ? err.message : 'renderer_removal_failed',
        })
      }
    })

    const unsubMobileCreateWorktree = mobile.onCreateWorktreeRequest(async ({ requestId, repoPath, branch, baseBranch, filesToCopy }) => {
      try {
        const project = useProjectsStore.getState().projects.find((p) => p.path === repoPath)
        if (!project) {
          mobile.sendCreateWorktreeResult({ requestId, ok: false, reason: 'not_found' })
          return
        }
        // Run the desktop's full add flow (mints the stable worktree id, honors
        // the configured storage path via the git IPC handler, copies any chosen
        // env/secret files, refreshes the sidebar). select:false so a remote
        // create never steals the desktop's current worktree selection.
        const newWt = await useProjectsStore.getState().addWorktree(project.id, branch, baseBranch, filesToCopy, { select: false })
        // Hand the new worktree's path/id back so the device can navigate
        // straight into it and auto-launch its chosen agent.
        mobile.sendCreateWorktreeResult({ requestId, ok: true, worktreePath: newWt?.path, worktreeId: newWt?.id })
      } catch (err) {
        console.error('[Braid] mobile addWorktree failed:', err)
        mobile.sendCreateWorktreeResult({
          requestId,
          ok: false,
          reason: err instanceof Error ? err.message : 'renderer_creation_failed',
        })
      }
    })

    // Keep dock badge in sync with sessions + big terminal agents needing attention
    const computeBadge = () => {
      const sessionCount = Object.values(useSessionsStore.getState().sessions)
        .filter(s => s.status === 'waiting_input').length
      const terminalCount = Object.values(useUIStore.getState().bigTerminalStatusById)
        .filter(e => e.state === 'waiting' || e.state === 'blocked').length
      return sessionCount + terminalCount
    }
    let lastBadge = computeBadge()
    const unsubBadge = useSessionsStore.subscribe(() => {
      const next = computeBadge()
      if (next !== lastBadge) { lastBadge = next; dock.setBadgeCount(next) }
    })
    const unsubTerminalBadge = useUIStore.subscribe(() => {
      const next = computeBadge()
      if (next !== lastBadge) { lastBadge = next; dock.setBadgeCount(next) }
    })

    // Tell the main process which big terminal this window is currently viewing,
    // so a paired phone can warn before closing a terminal that's open here.
    // Only the terminalId transitions matter; ignore unrelated store churn.
    let lastDesktopTerminalId: string | null = null
    const reportDesktopActiveTerminal = () => {
      const view = selectActiveCenterView(useUIStore.getState())
      const terminalId = view?.type === 'terminal' ? view.terminalId : null
      if (terminalId === lastDesktopTerminalId) return
      lastDesktopTerminalId = terminalId
      window.api.pty.setDesktopActiveTerminal(terminalId)
    }
    reportDesktopActiveTerminal()
    const unsubDesktopActiveTerminal = useUIStore.subscribe(reportDesktopActiveTerminal)

    return () => {
      cleanup()
      unsubSettings()
      cleanupUpdater()
      cleanupAgentDetection()
      unsubRemoteBigTerminal()
      unsubBigTerminalRenamed()
      unsubBigTerminalClosed()
      unsubMobileRemoveWorktree()
      unsubMobileCreateWorktree()
      unsubBadge()
      unsubTerminalBadge()
      unsubDesktopActiveTerminal()
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
      <div className="app-shell">
      <div className="app">
        <ActivityBar />
        <div className="sidebar-panel" style={{ width: sidebarPanelOpen ? sidebarWidth : 0, minWidth: sidebarPanelOpen ? SIDEBAR_MIN_WIDTH : 0 }}>
          <SidebarView />
        </div>
        {sidebarPanelOpen && <ResizeHandle direction="horizontal" onResize={handleSidebarResize} onResizeEnd={persistSidebarWidth} />}
        {/* Hide center+right when an app-level page or a web app is active, but keep mounted */}
        <div style={{ display: (missionControlActive || tasksActive || mobilePairingActive || webAppActive) ? 'none' : 'contents' }}>
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
        {tasksEverOpened.current && (
          <div style={{ display: tasksActive ? 'contents' : 'none' }}>
            <TasksView />
          </div>
        )}
        {mobilePairingEverOpened.current && (
          <div style={{ display: mobilePairingActive ? 'contents' : 'none' }}>
            <MobilePairingView />
          </div>
        )}
        {webAppsEnabled && (
          <div style={{ display: !missionControlActive && !tasksActive && webAppActive ? 'contents' : 'none' }}>
            <WebAppOverlay />
          </div>
        )}
      </div>
      <UsageStatusBar />
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
      <AdminInstallDialog />
      <OnboardingOverlay />
      <FeatureTour />
      <SimulatorTour />
    </ErrorBoundary>
  )
}
