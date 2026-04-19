import { useReducer, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionsStore, useSessionsForWorktree, getLastActiveForWorktree } from '@/store/sessions'
import { useUIStore, selectChangesOpen, selectActiveCenterView } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { useDragScroll } from '@/hooks/useDragScroll'
import { useTabReorder } from '@/hooks/useTabReorder'
import { Tooltip } from '@/components/shared/Tooltip'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { IconTerminal } from '@/components/shared/icons'
import type { AgentSession } from '@/types'
import { getSessionTitle } from '@/lib/sessionTitle'
import { disposeBigTerminal } from './bigTerminalCache'
import { SessionTab } from './SessionTab'
import { TerminalTab } from './TerminalTab'
import { FileTab } from './FileTab'
import { ChangesTab } from './ChangesTab'

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

  // Big terminal tabs — raw-data select, transform with useMemo (useShallow-safe).
  const bigTerminalsRaw = useUIStore((s) => s.bigTerminalsByWorktree)
  const bigTerminals = useMemo(
    () => (selectedWorktreeId ? (bigTerminalsRaw[selectedWorktreeId] ?? []) : []),
    [bigTerminalsRaw, selectedWorktreeId]
  )
  const createBigTerminal = useUIStore((s) => s.createBigTerminal)
  const closeBigTerminalAction = useUIStore((s) => s.closeBigTerminal)
  const renameBigTerminal = useUIStore((s) => s.renameBigTerminal)
  const bigTerminalEnabled = useUIStore((s) => s.bigTerminalEnabled)

  const closeTerminalFully = useCallback(
    (terminalId: string) => {
      if (!selectedWorktreeId) return
      disposeBigTerminal(terminalId)
      closeBigTerminalAction(selectedWorktreeId, terminalId)
    },
    [selectedWorktreeId, closeBigTerminalAction]
  )

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

  // Unified tab order: reconciles persisted tabOrder with live sessions/files/changes/terminals.
  // New keys are appended; stale keys dropped. Keys: s:<id>, f:<path>, changes, t:<id>.
  const unifiedTabs = useMemo(() => {
    const sessionKeys = sessions.map((s) => `s:${s.id}`)
    const fileKeys = openFilePaths.map((p) => `f:${p}`)
    const changesKeys = changesOpen ? ['changes'] : []
    const terminalKeys = bigTerminals.map((bt) => `t:${bt.id}`)
    const all = [...sessionKeys, ...fileKeys, ...changesKeys, ...terminalKeys]
    const allValid = new Set(all)
    const valid = tabOrder.filter((k) => allValid.has(k))
    const newEntries = all.filter((k) => !valid.includes(k))
    return [...valid, ...newEntries]
  }, [tabOrder, sessions, openFilePaths, changesOpen, bigTerminals])

  // Persist reconciled order whenever it diverges.
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

  // Auto-switch activeSessionId on worktree change — restore last active tab
  useEffect(() => {
    if (!selectedWorktreeId || sessions.length === 0) return
    const activeInWorktree = sessions.some((s) => s.id === activeSessionId)
    if (!activeInWorktree) {
      const lastActive = getLastActiveForWorktree(selectedWorktreeId)
      const target = sessions.find((s) => s.id === lastActive) ?? sessions[0]
      setActiveSession(target.id)
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
      } else if (key.startsWith('t:')) {
        closeTerminalFully(key.slice(2))
      }
    },
    [sessions, closeSession, closeFile, closeChanges, closeTerminalFully, t]
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
        else if (key.startsWith('t:')) closeTerminalFully(key.slice(2))
      }
    },
    [sessions, closeSession, closeFile, closeChanges, closeTerminalFully, t]
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
            <SessionTab
              key={key}
              tabKey={key}
              session={session}
              displayTitle={displayTitle}
              isActive={isActive}
              isEditing={isEditing}
              isDragSource={isDragSource}
              isDraggedOver={isDraggedOver}
              statusClass={statusClass}
              editValue={local.editValue}
              inputRef={inputRef}
              closeActiveSessionTitle={t('closeActiveSessionTitle')}
              closeActiveSessionMessageFn={(status) => t('closeActiveSessionMessage', { status })}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              onActivate={() => handleSessionTabClick(session.id)}
              onKeyDown={handleTabKeyDown}
              onContextMenu={handleTabContextMenu}
              onClose={() => closeSession(session.id)}
              onStartEdit={(e) => startRename(e, session)}
              onEditValueChange={(v) => setLocal({ editValue: v })}
              onCommitEdit={commitRename}
              onCancelEdit={cancelRename}
            />
          )
        }

        // ── File tab ──────────────────────────────────────────────────────
        if (key.startsWith('f:')) {
          const filePath = key.slice(2)
          if (!openFilePaths.includes(filePath)) return null
          const isActive = activeCenterView?.type === 'file' && activeCenterView.path === filePath
          return (
            <FileTab
              key={key}
              tabKey={key}
              filePath={filePath}
              isActive={isActive}
              isDirty={dirtyFilePaths.has(filePath)}
              isDragSource={isDragSource}
              isDraggedOver={isDraggedOver}
              unsavedLabel={t('unsavedChanges')}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              onActivate={() => setActiveCenterView({ type: 'file', path: filePath })}
              onKeyDown={handleTabKeyDown}
              onContextMenu={handleTabContextMenu}
              onClose={() => closeFile(filePath)}
            />
          )
        }

        // ── Changes tab (single) ──────────────────────────────────────
        if (key === 'changes') {
          const isActive = activeCenterView?.type === 'changes'
          return (
            <ChangesTab
              key={key}
              tabKey={key}
              label={t('diffReviewTab')}
              isActive={isActive}
              isDragSource={isDragSource}
              isDraggedOver={isDraggedOver}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              onActivate={() => setActiveCenterView({ type: 'changes' })}
              onKeyDown={handleTabKeyDown}
              onContextMenu={handleTabContextMenu}
              onClose={() => closeChanges()}
            />
          )
        }

        // ── Big terminal tab ─────────────────────────────────────────────
        if (key.startsWith('t:')) {
          const terminalId = key.slice(2)
          const tab = bigTerminals.find((bt) => bt.id === terminalId)
          if (!tab) return null
          const isActive =
            activeCenterView?.type === 'terminal' && activeCenterView.terminalId === terminalId
          const isEditing = local.editingId === `t:${terminalId}`
          return (
            <TerminalTab
              key={key}
              tab={tab}
              tabKey={key}
              isActive={isActive}
              isEditing={isEditing}
              isDragSource={isDragSource}
              isDraggedOver={isDraggedOver}
              editValue={local.editValue}
              inputRef={inputRef}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              onActivate={() => setActiveCenterView({ type: 'terminal', terminalId })}
              onKeyDown={handleTabKeyDown}
              onContextMenu={handleTabContextMenu}
              onClose={() => closeTerminalFully(terminalId)}
              onStartEdit={() => setLocal({ editValue: tab.label, editingId: `t:${terminalId}` })}
              onEditValueChange={(v) => setLocal({ editValue: v })}
              onCommitEdit={() => {
                if (selectedWorktreeId) renameBigTerminal(selectedWorktreeId, terminalId, local.editValue)
                setLocal({ editingId: null })
              }}
              onCancelEdit={() => setLocal({ editingId: null })}
            />
          )
        }

        return null
      })}

      {bigTerminalEnabled && (
        <Tooltip content={t('newBigTerminal')} position="bottom">
          <button
            className="tab tab--add tab--add-terminal"
            aria-label={t('newBigTerminal')}
            onClick={() => {
              if (!selectedWorktreeId) return
              const id = createBigTerminal(selectedWorktreeId)
              setActiveCenterView({ type: 'terminal', terminalId: id })
            }}
          >
            <IconTerminal size={12} />
            <span>+</span>
          </button>
        </Tooltip>
      )}

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
