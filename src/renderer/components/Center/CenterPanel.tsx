import { memo, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { SessionTabBar } from './SessionTabBar'
import { ChatView } from './ChatView'
import { BigTerminalView } from './BigTerminalView'
import { useUIStore, selectChangesOpen, selectActiveCenterView } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { useSessionsStore, useSessionsForWorktree } from '@/store/sessions'
import { Tooltip } from '@/components/shared/Tooltip'
import { OpenInDropdown } from '@/components/shared/OpenInDropdown'
import { IconSidebarRight, IconMessagePlus, IconPencil, IconArrowLeft, IconTerminal, AgentIcon } from '@/components/shared/icons'
import { getAgentEntry } from '@/lib/agentCatalog'
import { BottomTerminalStrip } from '@/components/shared/BottomTerminalStrip'
import { Button, EmptyState, Spinner } from '@/components/ui'
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation'
import { navigateTab } from '@/lib/tabNavigation'

// Lazy-loaded: FileViewer pulls in Monaco editor + react-markdown
const FileViewer = lazy(() => import('@/components/Right/FileViewer').then((m) => ({ default: m.FileViewer })))
const CodeReviewView = lazy(() => import('./CodeReviewView').then((m) => ({ default: m.CodeReviewView })))

export const CenterPanel = memo(function CenterPanel() {
  const { t } = useTranslation('center')
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const activeCenterView = useUIStore(selectActiveCenterView)
  const openFilePaths = useUIStore((s) => s.openFilePaths)
  const setFileDirty = useUIStore((s) => s.setFileDirty)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)
  const sidebarPanelOpen = useUIStore((s) => s.sidebarPanelOpen)
  const rightPanelVisible = useUIStore((s) => s.rightPanelVisible)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const bottomTerminalEnabled = useUIStore((s) => s.bottomTerminalEnabled)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === selectedProjectId))
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)

  const sessions = useSessionsForWorktree(selectedWorktreeId)
  const createSession = useSessionsStore((s) => s.createSession)
  const sessionsLoaded = useSessionsStore((s) => s.sessionsLoaded)

  const magicTrackpad = useUIStore((s) => s.magicTrackpad)
  const panelRef = useRef<HTMLDivElement>(null)
  const noRef = useRef<HTMLDivElement>(null)
  const handleSwipeNavigate = useCallback((direction: -1 | 1) => {
    navigateTab(direction)
  }, [])
  useSwipeNavigation(magicTrackpad ? panelRef : noRef, handleSwipeNavigate)

  const changesOpen = useUIStore(selectChangesOpen)
  const showFile = activeCenterView?.type === 'file'
  const showTerminal = activeCenterView?.type === 'terminal'
  const showCodeReview = activeCenterView?.type === 'codeReview'
  const hasBigTerminals = useUIStore((s) => selectedWorktreeId ? (s.bigTerminalsByWorktree[selectedWorktreeId]?.length ?? 0) > 0 : false)
  const activeTerminalId = showTerminal ? activeCenterView.terminalId : null
  const activeTerminalTab = useUIStore((s) => {
    if (!activeTerminalId || !selectedWorktreeId) return undefined
    return s.bigTerminalsByWorktree[selectedWorktreeId]?.find((t) => t.id === activeTerminalId)
  })
  const initialCommand = activeTerminalTab?.initialCommand
  const terminalAgentId = activeTerminalTab?.agentId
  const hasNoTabs = sessionsLoaded && sessions.length === 0 && openFilePaths.length === 0 && !changesOpen && !hasBigTerminals && !showCodeReview

  const lastNewTabAction = useUIStore((s) => s.lastNewTabAction)
  const createBigTerminal = useUIStore((s) => s.createBigTerminal)

  const handleNewTab = useCallback(() => {
    if (!selectedWorktreeId || !worktree) return
    // Handle agent:* actions (including legacy 'claudeCode')
    const agentAction = lastNewTabAction === 'claudeCode' ? 'agent:claude' : lastNewTabAction
    if (agentAction.startsWith('agent:')) {
      const agentId = agentAction.slice(6)
      const entry = getAgentEntry(agentId)
      if (entry) {
        const id = createBigTerminal(selectedWorktreeId, entry.label, entry.launchCmd, entry.id)
        setActiveCenterView({ type: 'terminal', terminalId: id })
        return
      }
    }
    if (lastNewTabAction === 'terminal') {
      const id = createBigTerminal(selectedWorktreeId)
      setActiveCenterView({ type: 'terminal', terminalId: id })
    } else {
      const id = createSession(selectedWorktreeId, worktree.path)
      setActiveCenterView({ type: 'session', sessionId: id })
    }
  }, [selectedWorktreeId, worktree, lastNewTabAction, createSession, createBigTerminal, setActiveCenterView])

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
    return { icon: <IconPencil size={13} />, label: t('newChat') }
  }, [lastNewTabAction, t])

  const handleDirtyChange = useCallback((path: string, dirty: boolean) => {
    setFileDirty(path, dirty)
  }, [setFileDirty])

  return (
    <div className="center-panel" data-tour="chat-panel" ref={panelRef}>
      <div
        className="drag-region drag-region--with-toggles"
        style={!sidebarPanelOpen ? { paddingLeft: 30 } : undefined}
      >
        {worktree && <OpenInDropdown path={worktree.path} label={worktree.path.split('/').filter(Boolean).at(-1) ?? worktree.branch} />}
        <Tooltip content={`${t('toggleRightPanel')} (\u2318\u21E7B)`} position="bottom">
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
        <>
          <SessionTabBar />
          {/* Content area - min-height: 0 lets it shrink when bottom terminal expands */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {hasNoTabs ? (
              <EmptyState
                icon={<IconMessagePlus />}
                title={t('emptyStateHeading')}
                hint={t('emptyStateHint')}
                action={<Button variant="primary" onClick={handleNewTab}>{emptyStateProps.icon}{emptyStateProps.label}</Button>}
              />
            ) : showFile ? (
              <Suspense fallback={<Spinner size="md" />}>
                <FileViewer
                  filePath={activeCenterView.path}
                  projectRoot={worktree?.path ?? project?.path ?? null}
                  onDirtyChange={handleDirtyChange}
                />
              </Suspense>
            ) : showTerminal ? (
              <BigTerminalView
                terminalId={activeCenterView.terminalId}
                worktreePath={worktree?.path ?? ''}
                initialCommand={initialCommand}
                agentId={terminalAgentId}
              />
            ) : showCodeReview ? (
              <Suspense fallback={<Spinner size="md" />}>
                <CodeReviewView worktreePath={worktree?.path ?? ''} />
              </Suspense>
            ) : (
              <ChatView worktreePath={worktree?.path ?? ''} />
            )}
          </div>
          {bottomTerminalEnabled && <BottomTerminalStrip />}
        </>
      ) : (
        <EmptyState icon={<IconArrowLeft size={28} />} title={t('selectWorktreeHint')} />
      )}
    </div>
  )
})
