import { memo, useCallback, useRef, lazy, Suspense, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { usePrStatus } from '@/store/prCache'
import { FileTree } from './FileTree'
import { SearchView } from './SearchView'
import { ChangesView } from './ChangesView'
import { TabbedTerminal } from './TabbedTerminal'
import { SetupRunPanel } from './SetupRunPanel'
import { ChecksView } from './ChecksView'
import { PrMergeBar } from './PrMergeBar'
import { Tooltip } from '@/components/shared/Tooltip'
import { EmptyState, Spinner } from '@/components/ui'
import { ResizeHandle } from '@/components/shared/ResizeHandle'

// Lazy-loaded: these pull in heavy deps (Tiptap ~5MB, react-device-mockup, etc.)
const NotesView = lazy(() => import('./NotesView').then((m) => ({ default: m.NotesView })))
const SimulatorView = lazy(() => import('./SimulatorView').then((m) => ({ default: m.SimulatorView })))
const WindowCaptureView = lazy(() => import('./WindowCaptureView').then((m) => ({ default: m.WindowCaptureView })))
import {
  IconFile,
  IconSearch,
  IconDiff,
  IconClipboardCheck,
  IconBook,
  IconSmartphone,
  IconMonitor,
  IconArrowLeft
} from '@/components/shared/icons'
import type { RightPanelTab } from '@/types'

export const RightPanel = memo(function RightPanel() {
  const { t } = useTranslation('right')
  const activeTab = useUIStore((s) => s.rightPanelTab)
  const rightPanelVisible = useUIStore((s) => s.rightPanelVisible)
  const missionControlActive = useUIStore((s) => s.missionControlActive)
  const activeWebAppId = useUIStore((s) => s.activeWebAppId)
  const webAppsEnabled = useUIStore((s) => s.webAppsEnabled)
  const setTab = useUIStore((s) => s.setRightPanelTab)
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const openFile = useUIStore((s) => s.openFile)
  const terminalCollapsed = useUIStore((s) => s.terminalCollapsed)
  const setTerminalCollapsed = useUIStore((s) => s.setTerminalCollapsed)
  const terminalHeight = useUIStore((s) => s.terminalHeight)
  const setTerminalHeight = useUIStore((s) => s.setTerminalHeight)
  const persistTerminalHeight = useUIStore((s) => s.persistTerminalHeight)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleTerminalResize = useCallback((delta: number) => {
    const current = useUIStore.getState().terminalHeight || (containerRef.current?.clientHeight ?? 400) / 2
    setTerminalHeight(current - delta)
  }, [setTerminalHeight])

  const experimentalCapture = useUIStore((s) => s.experimentalCapture)
  const bottomTerminalEnabled = useUIStore((s) => s.bottomTerminalEnabled)
  const tabDisplayMode = useUIStore((s) => s.tabDisplayMode)

  const project = useProjectsStore((s) => s.projects.find((p) => p.id === selectedProjectId))
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)
  const pr = usePrStatus(worktree?.path ?? '', { forceRefreshOnMount: true })

  const isMobile = project?.platform === 'mobile'
  const panelActive = rightPanelVisible && !missionControlActive && !(webAppsEnabled && activeWebAppId)
  const changesCount = useUIStore((s) => s.changesCounts[worktree?.path ?? ''] ?? 0)

  const TABS: { id: RightPanelTab; label: string; tooltip: string; badge?: number; icon: ComponentType<{ size?: number }> }[] = [
    { id: 'files', label: t('filesTab'), tooltip: t('filesTabTooltip'), icon: IconFile },
    { id: 'search', label: t('searchTab'), tooltip: t('searchTabTooltip'), icon: IconSearch },
    { id: 'changes', label: t('changesTab'), tooltip: t('changesTabTooltip'), badge: changesCount, icon: IconDiff },
    { id: 'overview', label: t('checksTab'), tooltip: t('checksTabTooltip'), icon: IconClipboardCheck },
    { id: 'notes', label: t('notesTab'), tooltip: t('notesTabTooltip'), icon: IconBook },
    ...(isMobile ? [
      { id: 'simulator' as RightPanelTab, label: t('simulatorTab'), tooltip: t('simulatorTabTooltip'), icon: IconSmartphone }
    ] : []),
    ...(experimentalCapture ? [
      { id: 'windowCapture' as RightPanelTab, label: t('windowCaptureTab'), tooltip: t('windowCaptureTabTooltip'), icon: IconMonitor }
    ] : [])
  ]

  return (
    <>
      {worktree && pr && pr.state === 'OPEN' ? (
        <PrMergeBar worktreePath={worktree.path} worktreeId={worktree.id} />
      ) : (
        <div className="drag-region" />
      )}
      <div className="tab-bar scrollbar-overlay" data-tour="right-panel" data-display={tabDisplayMode}>
        {TABS.map((tab) => (
          <Tooltip key={tab.id} content={tab.tooltip} position="bottom">
            <button
              className={`tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setTab(tab.id)}
            >
              {tabDisplayMode === 'labels' ? tab.label : <><tab.icon size={tabDisplayMode === 'icons' ? 16 : 14} />{tabDisplayMode === 'both' && <span>{tab.label}</span>}</>}
              {tab.badge ? <span className="tab-badge">{tab.badge}</span> : null}
            </button>
          </Tooltip>
        ))}
      </div>

      {!worktree ? (
        <EmptyState variant="panel" icon={<IconArrowLeft size={24} />} title={t('selectWorktree')} />
      ) : (
        <div ref={containerRef} className="right-panel-body">
          {/* Upper area: tabbed content */}
          <div className="right-panel-content">
            <div className="right-panel-pane" style={{ display: activeTab === 'files' ? 'flex' : 'none' }}>
              <FileTree worktreePath={worktree.path} onFileSelect={openFile} />
            </div>
            <div className="right-panel-pane right-panel-pane--column" style={{ display: activeTab === 'search' ? 'flex' : 'none' }}>
              <SearchView worktreePath={worktree.path} />
            </div>
            <div className="right-panel-pane right-panel-pane--column" style={{ display: activeTab === 'changes' ? 'flex' : 'none' }}>
              <ChangesView key={worktree.path} worktreePath={worktree.path} isActive={panelActive && activeTab === 'changes'} />
            </div>
            <div className="right-panel-pane right-panel-pane--column" style={{ display: activeTab === 'overview' ? 'flex' : 'none' }}>
              <ChecksView key={worktree.path} worktreePath={worktree.path} worktreeId={worktree.id} isActive={panelActive && activeTab === 'overview'} />
            </div>
            <div className="right-panel-pane right-panel-pane--column" style={{ display: activeTab === 'notes' ? 'flex' : 'none' }}>
              <Suspense fallback={<Spinner size="md" />}>
                <NotesView worktreeId={worktree.id} />
              </Suspense>
            </div>
            {/* Always mounted so state survives project/tab switches */}
            <div className="right-panel-pane right-panel-pane--column" style={{ display: isMobile && activeTab === 'simulator' ? 'flex' : 'none' }}>
              <Suspense fallback={<Spinner size="md" />}>
                <SimulatorView isActive={isMobile && activeTab === 'simulator'} mobileFramework={project?.mobileFramework} />
              </Suspense>
            </div>
            {experimentalCapture && (
              <div className="right-panel-pane right-panel-pane--column" style={{ display: activeTab === 'windowCapture' ? 'flex' : 'none' }}>
                <Suspense fallback={<Spinner size="md" />}>
                  <WindowCaptureView isActive={activeTab === 'windowCapture'} />
                </Suspense>
              </div>
            )}
          </div>

          {/* Bottom panel: full TabbedTerminal normally; Setup/Run-only when bottom terminal strip is active */}
          {!terminalCollapsed && (
            <ResizeHandle direction="vertical" onResize={handleTerminalResize} onResizeEnd={persistTerminalHeight} />
          )}
          <div
            data-tour="terminal"
            className={[
              'right-panel-terminal-host',
              terminalCollapsed ? 'right-panel-terminal-host--collapsed' : '',
            ].filter(Boolean).join(' ')}
            style={{
              height: terminalCollapsed ? 36 : (terminalHeight || 250),
              minHeight: terminalCollapsed ? 36 : 120,
            }}
          >
            {bottomTerminalEnabled ? (
              <SetupRunPanel
                worktreePath={worktree.path}
                projectId={selectedProjectId!}
                projectPath={project?.path ?? worktree.path}
                collapsed={terminalCollapsed}
                onToggleCollapse={() => setTerminalCollapsed(!useUIStore.getState().terminalCollapsed)}
              />
            ) : (
              <TabbedTerminal
                worktreePath={worktree.path}
                projectId={selectedProjectId!}
                projectPath={project?.path ?? worktree.path}
                hidden={terminalCollapsed}
                collapsed={terminalCollapsed}
                onToggleCollapse={() => setTerminalCollapsed(!useUIStore.getState().terminalCollapsed)}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
})
