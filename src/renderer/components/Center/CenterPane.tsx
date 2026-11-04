import { memo, useCallback, lazy, Suspense, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, type PaneId, type CenterView } from '@/store/ui'
import { EmptyState, Spinner } from '@/components/ui'
import { IconGlobe } from '@/components/shared/icons'
import { SessionTabBar } from './SessionTabBar'
import { ChatView } from './ChatView'
import { BigTerminalView } from './BigTerminalView'
import { BrowserSlot } from './Browser/BrowserSlot'

// Lazy-loaded: FileViewer pulls in Monaco editor + react-markdown
const FileViewer = lazy(() => import('@/components/Right/FileViewer').then((m) => ({ default: m.FileViewer })))
const CodeReviewView = lazy(() => import('./CodeReviewView').then((m) => ({ default: m.CodeReviewView })))

interface Props {
  pane: PaneId
  worktreeId: string
  worktreePath: string
  projectRoot: string | null
  view: CenterView | null
  /** Whether the pane's view points at a browser tab that exists. */
  browserTabExists: boolean
  /** Primary pane only: shown when the worktree has no tabs at all. */
  emptyState?: ReactNode
  split: boolean
  focused: boolean
  style?: CSSProperties
}

function TerminalPane({ worktreeId, terminalId, worktreePath }: { worktreeId: string; terminalId: string; worktreePath: string }) {
  const tab = useUIStore((s) => s.bigTerminalsByWorktree[worktreeId]?.find((t) => t.id === terminalId))
  return (
    <BigTerminalView
      terminalId={terminalId}
      worktreePath={worktreePath}
      initialCommand={tab?.initialCommand}
      initialInput={tab?.initialInput}
      agentId={tab?.agentId}
    />
  )
}

export const CenterPane = memo(function CenterPane({
  pane, worktreeId, worktreePath, projectRoot, view, browserTabExists, emptyState, split, focused, style,
}: Props) {
  const { t } = useTranslation('center')
  const setFileDirty = useUIStore((s) => s.setFileDirty)
  const setFocusedPane = useUIStore((s) => s.setFocusedPane)
  const handleDirtyChange = useCallback((path: string, dirty: boolean) => setFileDirty(path, dirty), [setFileDirty])

  let content: ReactNode
  if (emptyState) content = emptyState
  else if (view?.type === 'browser' && browserTabExists) content = <BrowserSlot pane={pane} />
  else if (view?.type === 'file') {
    content = (
      <Suspense fallback={<Spinner size="md" />}>
        <FileViewer filePath={view.path} projectRoot={projectRoot} onDirtyChange={handleDirtyChange} />
      </Suspense>
    )
  } else if (view?.type === 'terminal') {
    content = <TerminalPane key={view.terminalId} worktreeId={worktreeId} terminalId={view.terminalId} worktreePath={worktreePath} />
  } else if (pane === 'secondary') {
    content = <EmptyState variant="panel" icon={<IconGlobe size={24} />} title={t('splitEmpty')} />
  } else if (view?.type === 'codeReview') {
    content = (
      <Suspense fallback={<Spinner size="md" />}>
        <CodeReviewView worktreePath={worktreePath} />
      </Suspense>
    )
  } else {
    content = <ChatView worktreePath={worktreePath} />
  }

  return (
    <div
      className={`center-pane${split ? ' center-pane--split' : ''}${split && focused ? ' center-pane--focused' : ''}`}
      style={style}
      onMouseDownCapture={() => { if (split) setFocusedPane(worktreeId, pane) }}
    >
      <SessionTabBar pane={pane} />
      {/* Content area - min-height: 0 lets it shrink when bottom terminal expands */}
      <div className="center-pane-content">{content}</div>
    </div>
  )
})
