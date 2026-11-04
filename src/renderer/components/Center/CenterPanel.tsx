import { memo, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, selectChangesOpen, selectActiveCenterView } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { useSessionsStore, useSessionsForWorktree } from '@/store/sessions'
import { Tooltip } from '@/components/shared/Tooltip'
import { OpenInDropdown } from '@/components/shared/OpenInDropdown'
import { ResizeHandle } from '@/components/shared/ResizeHandle'
import { IconSidebarRight, IconMessagePlus, IconPencil, IconArrowLeft, IconTerminal, IconGlobe, AgentIcon } from '@/components/shared/icons'
import { getAgentEntry } from '@/lib/agentCatalog'
import { BottomTerminalStrip } from '@/components/shared/BottomTerminalStrip'
import { Button, EmptyState } from '@/components/ui'
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation'
import { navigateTab } from '@/lib/tabNavigation'
import { placeTabInPane } from '@/lib/centerPanes'
import { openBrowserTab } from '@/lib/browser/browserCommands'
import { BrowserHost } from './Browser/BrowserHost'
import { CenterPane } from './CenterPane'

export const CenterPanel = memo(function CenterPanel() {
  const { t } = useTranslation('center')
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const activeCenterView = useUIStore(selectActiveCenterView)
  const openFilePaths = useUIStore((s) => s.openFilePaths)
  const sidebarPanelOpen = useUIStore((s) => s.sidebarPanelOpen)
  const rightPanelVisible = useUIStore((s) => s.rightPanelVisible)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const bottomTerminalEnabled = useUIStore((s) => s.bottomTerminalEnabled)
  const split = useUIStore((s) => (s.selectedWorktreeId ? s.centerSplitByWorktree[s.selectedWorktreeId] : undefined))
  const setSplitRatio = useUIStore((s) => s.setSplitRatio)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === selectedProjectId))
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)

  const sessions = useSessionsForWorktree(selectedWorktreeId)
  const createSession = useSessionsStore((s) => s.createSession)
  const sessionsLoaded = useSessionsStore((s) => s.sessionsLoaded)

  const magicTrackpad = useUIStore((s) => s.magicTrackpad)
  const panelRef = useRef<HTMLDivElement>(null)
  const panesRef = useRef<HTMLDivElement>(null)
  const noRef = useRef<HTMLDivElement>(null)
  const handleSwipeNavigate = useCallback((direction: -1 | 1) => {
    navigateTab(direction)
  }, [])
  useSwipeNavigation(magicTrackpad ? panelRef : noRef, handleSwipeNavigate)

  const changesOpen = useUIStore(selectChangesOpen)
  const showCodeReview = activeCenterView?.type === 'codeReview'
  const browserTabIds = useUIStore((s) => s.browserTabsByWorktree[s.selectedWorktreeId ?? ''])
  // A stale persisted view can point at a closed tab; the pane falls back to its default view then.
  const tabExists = useCallback((view: typeof activeCenterView) =>
    view?.type === 'browser' && Boolean(browserTabIds?.some((tab) => tab.id === view.tabId)), [browserTabIds])
  const hasBrowserTabs = (browserTabIds?.length ?? 0) > 0
  const hasBigTerminals = useUIStore((s) => selectedWorktreeId ? (s.bigTerminalsByWorktree[selectedWorktreeId]?.length ?? 0) > 0 : false)
  const hasNoTabs = sessionsLoaded && sessions.length === 0 && openFilePaths.length === 0 && !changesOpen && !hasBigTerminals && !hasBrowserTabs && !showCodeReview && !split

  const lastNewTabAction = useUIStore((s) => s.lastNewTabAction)
  const createBigTerminal = useUIStore((s) => s.createBigTerminal)

  const handleNewTab = useCallback(() => {
    if (!selectedWorktreeId || !worktree) return
    // Handle agent:* actions (including legacy 'claudeCode')
    const agentAction = lastNewTabAction === 'claudeCode' ? 'agent:claude' : lastNewTabAction
    if (agentAction.startsWith('agent:')) {
      const entry = getAgentEntry(agentAction.slice(6))
      if (entry) {
        const id = createBigTerminal(selectedWorktreeId, entry.label, entry.launchCmd, entry.id)
        placeTabInPane(selectedWorktreeId, `t:${id}`, 'primary')
        return
      }
    }
    if (lastNewTabAction === 'terminal') {
      placeTabInPane(selectedWorktreeId, `t:${createBigTerminal(selectedWorktreeId)}`, 'primary')
    } else if (lastNewTabAction === 'browser') {
      openBrowserTab(selectedWorktreeId, { pane: 'primary' })
    } else {
      placeTabInPane(selectedWorktreeId, `s:${createSession(selectedWorktreeId, worktree.path)}`, 'primary')
    }
  }, [selectedWorktreeId, worktree, lastNewTabAction, createSession, createBigTerminal])

  const emptyStateProps = useMemo(() => {
    const agentAction = lastNewTabAction === 'claudeCode' ? 'agent:claude' : lastNewTabAction
    if (agentAction.startsWith('agent:')) {
      const agentId = agentAction.slice(6)
      const entry = getAgentEntry(agentId)
      if (entry) return { icon: <AgentIcon agentId={agentId} size={28} />, label: entry.label }
    }
    if (lastNewTabAction === 'terminal') {
      return { icon: <IconTerminal size={28} />, label: t('newBigTerminal') }
    }
    if (lastNewTabAction === 'browser') {
      return { icon: <IconGlobe size={13} />, label: t('browser.newBrowserTab') }
    }
    return { icon: <IconPencil size={13} />, label: t('newChat') }
  }, [lastNewTabAction, t])

  const handleSplitResize = useCallback((delta: number) => {
    const width = panesRef.current?.getBoundingClientRect().width ?? 0
    if (!width || !selectedWorktreeId || !split) return
    setSplitRatio(selectedWorktreeId, split.ratio + delta / width)
  }, [selectedWorktreeId, split, setSplitRatio])

  const worktreePath = worktree?.path ?? ''
  const projectRoot = worktree?.path ?? project?.path ?? null

  return (
    <div className="center-panel" data-tour="chat-panel" ref={panelRef}>
      <div
        className="drag-region drag-region--with-toggles"
        style={!sidebarPanelOpen ? { paddingLeft: 30 } : undefined}
      >
        {worktree && <OpenInDropdown path={worktree.path} label={worktree.path.split('/').filter(Boolean).at(-1) ?? worktree.branch} />}
        <Tooltip content={`${t('toggleRightPanel')} (⌘⇧B)`} position="bottom">
          <button
            className="drag-region-toggle"
            onClick={toggleRightPanel}
            style={{ opacity: rightPanelVisible ? 1 : 0.6 }}
          >
            <IconSidebarRight />
          </button>
        </Tooltip>
      </div>
      {selectedWorktreeId && worktree ? (
        <div className="center-body">
          <div className="center-panes" ref={panesRef}>
            <CenterPane
              pane="primary"
              worktreeId={selectedWorktreeId}
              worktreePath={worktreePath}
              projectRoot={projectRoot}
              view={activeCenterView}
              browserTabExists={tabExists(activeCenterView)}
              split={Boolean(split)}
              focused={!split || split.focused === 'primary'}
              style={split ? { flex: split.ratio } : undefined}
              emptyState={hasNoTabs ? (
                <EmptyState
                  variant="hero"
                  icon={<IconMessagePlus />}
                  title={t('emptyStateHeading')}
                  hint={t('emptyStateHint')}
                  action={<Button variant="primary" onClick={handleNewTab}>{emptyStateProps.icon}{emptyStateProps.label}</Button>}
                />
              ) : undefined}
            />
            {split && (
              <>
                <ResizeHandle direction="horizontal" onResize={handleSplitResize} />
                <CenterPane
                  pane="secondary"
                  worktreeId={selectedWorktreeId}
                  worktreePath={worktreePath}
                  projectRoot={projectRoot}
                  view={split.secondaryView}
                  browserTabExists={tabExists(split.secondaryView)}
                  split
                  focused={split.focused === 'secondary'}
                  style={{ flex: 1 - split.ratio }}
                />
              </>
            )}
          </div>
          {bottomTerminalEnabled && <BottomTerminalStrip />}
          {/* Always mounted so live pages survive tab, pane and worktree switches. */}
          <BrowserHost />
        </div>
      ) : (
        <EmptyState variant="panel" icon={<IconArrowLeft size={28} />} title={t('selectWorktreeHint')} />
      )}
    </div>
  )
})
