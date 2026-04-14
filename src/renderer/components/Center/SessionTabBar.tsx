import { useReducer, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionsStore, useSessionsForWorktree, getLastActiveForWorktree } from '@/store/sessions'
import { useUIStore, selectChangesOpen, selectActiveCenterView } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { FileIcon } from '@react-symbols/icons/utils'
import { useDragScroll } from '@/hooks/useDragScroll'
import { useTabReorder } from '@/hooks/useTabReorder'
import { Tooltip } from '@/components/shared/Tooltip'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { IconDiff } from '@/components/shared/icons'
import type { AgentSession } from '@/types'
import { getSessionTitle } from '@/lib/sessionTitle'

function getFileName(path: string): string {
  return path.split('/').pop() ?? path
}

interface TabBarLocal {
  editingId: string | null
  editValue: string
  menu: { x: number; y: number; key: string } | null
}

export function SessionTabBar() {
  const { t } = useTranslation('center')
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === selectedProjectId))
  const worktree = project?.worktrees.find((w) => w.id === selectedWorktreeId)

  const sessions = useSessionsForWorktree(selectedWorktreeId)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const setActiveSession = useSessionsStore((s) => s.setActiveSession)
  const createSession = useSessionsStore((s) => s.createSession)
  const closeSession = useSessionsStore((s) => s.closeSession)
  const renameSession = useSessionsStore((s) => s.renameSession)

  const openFilePaths = useUIStore((s) => s.openFilePaths)
  const changesOpen = useUIStore(selectChangesOpen)
  const dirtyFilePaths = useUIStore((s) => s.dirtyFilePaths)
  const activeCenterView = useUIStore(selectActiveCenterView)
  const closeFile = useUIStore((s) => s.closeFile)
  const closeChanges = useUIStore((s) => s.closeChanges)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)
  const tabOrder = useUIStore((s) => s.tabOrder)
  const setTabOrder = useUIStore((s) => s.setTabOrder)

  const [local, setLocal] = useReducer(
    (s: TabBarLocal, a: Partial<TabBarLocal>) => ({ ...s, ...a }),
    { editingId: null, editValue: '', menu: null } as TabBarLocal
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const { onMouseDown: tabBarMouseDown, isDragging: tabBarDragging, preventClickAfterDrag } = useDragScroll(tabBarRef)

  // Convert vertical wheel scroll to horizontal scroll on the tab bar
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = tabBarRef.current
    if (!el) return
    if (el.scrollWidth <= el.clientWidth) return
    e.preventDefault()
    el.scrollLeft += e.deltaY || e.deltaX
  }, [])

  // ── Unified tab order ─────────────────────────────────────────────────────
  // Reconcile persisted order with live sessions + files.
  // Keys: `s:${sessionId}` for sessions, `f:${filePath}` for files.
  // New entries not yet in the stored order are appended at the end;
  // stale entries (closed session/file) are dropped.
  const unifiedTabs = useMemo(() => {
    const sessionKeys = sessions.map((s) => `s:${s.id}`)
    const fileKeys = openFilePaths.map((p) => `f:${p}`)
    const changesKeys = changesOpen ? ['changes'] : []
    const allValid = new Set([...sessionKeys, ...fileKeys, ...changesKeys])
    const valid = tabOrder.filter((k) => allValid.has(k))
    const newEntries = [...sessionKeys, ...fileKeys, ...changesKeys].filter((k) => !valid.includes(k))
    return [...valid, ...newEntries]
  }, [tabOrder, sessions, openFilePaths, changesOpen])

  // Persist the reconciled order whenever it diverges from the stored tabOrder.
  // This handles session/file creation and deletion without extra bookkeeping.
  useEffect(() => {
    if (selectedWorktreeId && JSON.stringify(unifiedTabs) !== JSON.stringify(tabOrder)) {
      setTabOrder(unifiedTabs)
    }
  }, [unifiedTabs, tabOrder, selectedWorktreeId, setTabOrder])

  // ── Single unified drag-reorder ───────────────────────────────────────────
  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      const next = [...unifiedTabs]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      setTabOrder(next)
    },
    [unifiedTabs, setTabOrder]
  )

  const { dragKey, overKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } =
    useTabReorder(unifiedTabs, handleReorder)

  // Auto-switch activeSessionId when worktree changes — restore last active tab
  useEffect(() => {
    if (!selectedWorktreeId || sessions.length === 0) return
    const activeInWorktree = sessions.some((s) => s.id === activeSessionId)
    if (!activeInWorktree) {
      const lastActive = getLastActiveForWorktree(selectedWorktreeId)
      const target = sessions.find((s) => s.id === lastActive) ?? sessions[0]
      setActiveSession(target.id)
      // Sync per-worktree center view so the tab indicator matches.
      // Read fresh to avoid adding activeCenterView to deps (would cause
      // unnecessary re-runs on every tab click).
      const currentView = useUIStore.getState().activeCenterViewByWorktree[selectedWorktreeId] ?? null
      if (!currentView || currentView.type === 'session') {
        setActiveCenterView({ type: 'session', sessionId: target.id })
      }
    }
  }, [selectedWorktreeId, sessions, activeSessionId, setActiveSession, setActiveCenterView])

  useEffect(() => {
    if (local.editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [local.editingId])

  const startRename = useCallback((e: React.MouseEvent, session: AgentSession) => {
    e.stopPropagation()
    const hasRealName = session.name && session.name !== 'New Chat'
    setLocal({ editValue: hasRealName ? session.name : '', editingId: session.id })
  }, [])

  const commitRename = useCallback(() => {
    if (!local.editingId) return
    renameSession(local.editingId, local.editValue)
    setLocal({ editingId: null })
  }, [local.editingId, local.editValue, renameSession])

  const cancelRename = useCallback(() => {
    setLocal({ editingId: null })
  }, [])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelRename()
      }
    },
    [commitRename, cancelRename]
  )

  const handleSessionTabClick = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId)
      setActiveCenterView({ type: 'session', sessionId })
    },
    [setActiveSession, setActiveCenterView]
  )

  // Close a single tab — confirms if session is active
  const closeSingleTab = useCallback(
    (key: string) => {
      if (key.startsWith('s:')) {
        const sid = key.slice(2)
        const session = sessions.find((s) => s.id === sid)
        if (session && session.status !== 'idle' && session.status !== 'inactive') {
          const msg = `${t('closeActiveSessionTitle')}\n\n${t('closeActiveSessionMessage', { status: session.status })}`
          if (!window.confirm(msg)) return
        }
        closeSession(sid)
      } else if (key.startsWith('f:')) {
        closeFile(key.slice(2))
      } else if (key === 'changes') {
        closeChanges()
      }
    },
    [sessions, closeSession, closeFile, closeChanges, t]
  )

  // Close multiple tabs — batches active-session confirmation into one dialog
  const closeManyTabs = useCallback(
    (keys: string[]) => {
      const activeSessions = keys.filter((k) => {
        if (!k.startsWith('s:')) return false
        const s = sessions.find((s) => s.id === k.slice(2))
        return s && s.status !== 'idle' && s.status !== 'inactive'
      })
      if (activeSessions.length > 0) {
        const msg = `${t('closeActiveSessionTitle')}\n\n${t('closeActiveSessionsBatch', { count: activeSessions.length })}`
        if (!window.confirm(msg)) return
      }
      for (const key of keys) {
        if (key.startsWith('s:')) closeSession(key.slice(2))
        else if (key.startsWith('f:')) closeFile(key.slice(2))
        else if (key === 'changes') closeChanges()
      }
    },
    [sessions, closeSession, closeFile, closeChanges, t]
  )

  // Keyboard-accessible tab close — Delete key closes the focused tab.
  // This complements the context menu (right-click → Close) and provides
  // keyboard access since the visual × span is aria-hidden.
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, key: string) => {
      if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
        e.preventDefault()
        closeSingleTab(key)
      }
    },
    [closeSingleTab]
  )

  const handleTabContextMenu = useCallback(
    (e: React.MouseEvent, key: string) => {
      e.preventDefault()
      e.stopPropagation()
      setLocal({ menu: { x: e.clientX, y: e.clientY, key } })
    },
    []
  )

  const menuItems = useMemo((): ContextMenuItem[] => {
    if (!local.menu) return []
    const targetKey = local.menu.key
    return [
      { label: t('tabClose'), onClick: () => closeSingleTab(targetKey) },
      {
        label: t('tabCloseOthers'),
        disabled: unifiedTabs.length <= 1,
        onClick: () => closeManyTabs(unifiedTabs.filter((k) => k !== targetKey))
      },
      {
        label: t('tabCloseAll'),
        onClick: () => closeManyTabs([...unifiedTabs])
      }
    ]
  }, [local.menu, unifiedTabs, closeSingleTab, closeManyTabs, t])

  if (!selectedWorktreeId || !worktree) return null

  return (
    <div
      ref={tabBarRef}
      role="tablist"
      aria-label={t('sessionTabs')}
      data-tour="session-tabs"
      className={`tab-bar scrollbar-overlay${tabBarDragging ? ' tab-bar--dragging' : ''}`}
      onMouseDown={tabBarMouseDown}
      onWheel={handleWheel}
      onClickCapture={preventClickAfterDrag()}
    >
      {unifiedTabs.map((key) => {
        const isDragSource = dragKey === key
        const isDraggedOver = overKey === key && dragKey !== key

        // ── Session tab ───────────────────────────────────────────────────
        if (key.startsWith('s:')) {
          const sessionId = key.slice(2)
          const session = sessions.find((s) => s.id === sessionId)
          if (!session) return null
          const isEditing = local.editingId === session.id
          const displayTitle = getSessionTitle(session)
          const isActive =
            activeCenterView?.type === 'session'
              ? activeCenterView.sessionId === session.id
              : activeCenterView === null && session.id === activeSessionId
          const statusClass =
            session.status === 'running' ? ' tab--running'
            : session.status === 'waiting_input' ? ' tab--waiting'
            : session.status === 'error' ? ' tab--error'
            : ''

          return (
            <button
              key={key}
              role="tab"
              aria-selected={isActive}
              className={`tab${isActive ? ' active' : ''}${isDraggedOver ? ' tab--drop-target' : ''}${isDragSource ? ' tab--dragging' : ''}${statusClass}`}
              draggable={!isEditing}
              onDragStart={onDragStart(key)}
              onDragOver={onDragOver(key)}
              onDragLeave={onDragLeave}
              onDrop={onDrop(key)}
              onDragEnd={onDragEnd}
              onClick={() => !isEditing && handleSessionTabClick(session.id)}
              onKeyDown={(e) => handleTabKeyDown(e, key)}
              onContextMenu={(e) => handleTabContextMenu(e, key)}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="tab-rename-input"
                  value={local.editValue}
                  placeholder={displayTitle}
                  onChange={(e) => setLocal({ editValue: e.target.value })}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <Tooltip content={displayTitle} position="bottom" delay={600}>
                  <span className="tab-text" onDoubleClick={(e) => startRename(e, session)}>
                    {displayTitle}
                  </span>
                </Tooltip>
              )}
              <span
                className="tab-close"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation()
                  if (session.status !== 'idle' && session.status !== 'inactive') {
                    const msg = `${t('closeActiveSessionTitle')}\n\n${t('closeActiveSessionMessage', { status: session.status })}`
                    if (!window.confirm(msg)) return
                  }
                  closeSession(session.id)
                }}
              >
                ×
              </span>
            </button>
          )
        }

        // ── File tab ──────────────────────────────────────────────────────
        if (key.startsWith('f:')) {
          const filePath = key.slice(2)
          if (!openFilePaths.includes(filePath)) return null
          const isActive = activeCenterView?.type === 'file' && activeCenterView.path === filePath
          const isDirty = dirtyFilePaths.has(filePath)
          const name = getFileName(filePath)

          return (
            <button
              key={key}
              role="tab"
              aria-selected={isActive}
              className={`tab tab-file${isActive ? ' active' : ''}${isDraggedOver ? ' tab--drop-target' : ''}${isDragSource ? ' tab--dragging' : ''}`}
              draggable
              onDragStart={onDragStart(key)}
              onDragOver={onDragOver(key)}
              onDragLeave={onDragLeave}
              onDrop={onDrop(key)}
              onDragEnd={onDragEnd}
              onClick={() => setActiveCenterView({ type: 'file', path: filePath })}
              onKeyDown={(e) => handleTabKeyDown(e, key)}
              onContextMenu={(e) => handleTabContextMenu(e, key)}
            >
              <Tooltip content={filePath} position="bottom" delay={600}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'inherit' }}>
                  <span className="tab-file-icon">
                    <FileIcon fileName={name} autoAssign width={14} height={14} />
                  </span>
                  <span className="tab-text">{name}</span>
                </span>
              </Tooltip>
              {isDirty && <span className="tab-dirty" aria-label={t('unsavedChanges')}>●</span>}
              <span
                className="tab-close"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation()
                  closeFile(filePath)
                }}
              >
                ×
              </span>
            </button>
          )
        }

        // ── Changes tab (single) ──────────────────────────────────────
        if (key === 'changes') {
          const isActive = activeCenterView?.type === 'changes'
          return (
            <button
              key={key}
              role="tab"
              aria-selected={isActive}
              className={`tab tab-diff${isActive ? ' active' : ''}${isDraggedOver ? ' tab--drop-target' : ''}${isDragSource ? ' tab--dragging' : ''}`}
              draggable
              onDragStart={onDragStart(key)}
              onDragOver={onDragOver(key)}
              onDragLeave={onDragLeave}
              onDrop={onDrop(key)}
              onDragEnd={onDragEnd}
              onClick={() => setActiveCenterView({ type: 'changes' })}
              onKeyDown={(e) => handleTabKeyDown(e, key)}
              onContextMenu={(e) => handleTabContextMenu(e, key)}
            >
              <Tooltip content={t('diffReviewTab')} position="bottom" delay={600}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                  <IconDiff size={12} />
                  <span className="tab-text">{t('diffReviewTab')}</span>
                </span>
              </Tooltip>
              <span
                className="tab-close"
                aria-hidden="true"
                onClick={(e) => { e.stopPropagation(); closeChanges() }}
              >
                ×
              </span>
            </button>
          )
        }

        return null
      })}

      <Tooltip content={t('newChat')} position="bottom">
        <button
          className="tab tab--add"
          aria-label={t('newChat')}
          onClick={() => {
            const id = createSession(selectedWorktreeId, worktree.path)
            setActiveCenterView({ type: 'session', sessionId: id })
          }}
        >
          +
        </button>
      </Tooltip>

      {local.menu && (
        <ContextMenu
          x={local.menu.x}
          y={local.menu.y}
          items={menuItems}
          onClose={() => setLocal({ menu: null })}
        />
      )}
    </div>
  )
}
