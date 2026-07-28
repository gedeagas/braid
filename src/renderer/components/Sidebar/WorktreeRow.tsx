import { useReducer, useEffect, useRef } from 'react'
import type { Worktree, WorktreeStatus } from '@/types'
import { StatusDot } from './StatusDot'
import { PrIcon } from './PrIcon'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { Tooltip } from '@/components/shared/Tooltip'
import { Button, Checkbox, Spinner } from '@/components/ui'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { useSessionsForWorktree } from '@/store/sessions'
import { useTranslation } from 'react-i18next'
import { IconGitBranch } from '@/components/shared/icons'
import { worktreeName } from '@/lib/branchValidation'
import { flash } from '@/store/flash'
import { cleanIpcError } from '@/lib/ipc'

interface Props {
  worktree: Worktree
  dragOverId: string | null
  draggingId: string | null
  isNew?: boolean
  isFocused?: boolean
  draggable?: boolean
  projectName?: string
  onRegisterRef?: (el: HTMLElement | null) => void
}

type RowState = {
  menu: { x: number; y: number } | null
  showDeleteConfirm: boolean
  dontAskAgain: boolean
  isDeleting: boolean
}
type RowAction =
  | { type: 'OPEN_MENU'; x: number; y: number }
  | { type: 'CLOSE_MENU' }
  | { type: 'SHOW_DELETE_CONFIRM' }
  | { type: 'HIDE_DELETE_CONFIRM' }
  | { type: 'SET_DONT_ASK'; value: boolean }
  | { type: 'SET_DELETING'; value: boolean }

function rowReducer(state: RowState, action: RowAction): RowState {
  switch (action.type) {
    case 'OPEN_MENU': return { ...state, menu: { x: action.x, y: action.y } }
    case 'CLOSE_MENU': return { ...state, menu: null }
    case 'SHOW_DELETE_CONFIRM': return { ...state, showDeleteConfirm: true }
    case 'HIDE_DELETE_CONFIRM': return { ...state, showDeleteConfirm: false }
    case 'SET_DONT_ASK': return { ...state, dontAskAgain: action.value }
    case 'SET_DELETING': return { ...state, isDeleting: action.value }
  }
}

export function WorktreeRow({ worktree, dragOverId, draggingId, isNew, isFocused, draggable = true, projectName, onRegisterRef }: Props) {
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)
  const pinnedWorktrees = useUIStore((s) => s.pinnedWorktrees)
  const togglePinWorktree = useUIStore((s) => s.togglePinWorktree)
  const removeWorktree = useProjectsStore((s) => s.removeWorktree)
  const skipDeleteConfirm = useUIStore((s) => s.skipDeleteWorktreeConfirm)
  const setSkipDeleteConfirm = useUIStore((s) => s.setSkipDeleteWorktreeConfirm)
  const sessions = useSessionsForWorktree(worktree.id)
  // Primitive selectors for big terminal agent status.
  // Each returns a number or boolean so Object.is comparison is stable (no infinite loops).
  const agentTerminalCount = useUIStore((s) => {
    const tabs = s.bigTerminalsByWorktree[worktree.id]
    if (!tabs) return 0
    let n = 0
    for (const t of tabs) { const e = s.bigTerminalStatusById[t.id]; if (e) n++ }
    return n
  })
  const hasWorkingAgent = useUIStore((s) => {
    const tabs = s.bigTerminalsByWorktree[worktree.id]
    if (!tabs) return false
    return tabs.some(t => s.bigTerminalStatusById[t.id]?.state === 'working')
  })
  const hasWaitingAgent = useUIStore((s) => {
    const tabs = s.bigTerminalsByWorktree[worktree.id]
    if (!tabs) return false
    return tabs.some(t => { const st = s.bigTerminalStatusById[t.id]?.state; return st === 'waiting' || st === 'blocked' })
  })
  const hasDoneAgent = useUIStore((s) => {
    const tabs = s.bigTerminalsByWorktree[worktree.id]
    if (!tabs) return false
    return tabs.some(t => s.bigTerminalStatusById[t.id]?.state === 'done')
  })
  const { t } = useTranslation('sidebar')

  const clearNewlyAdded = useUIStore((s) => s.setNewlyAddedWorktreeId)

  const rowRef = useRef<HTMLDivElement>(null)
  const deleteInFlightRef = useRef(false)

  useEffect(() => {
    const el = rowRef.current
    if (!onRegisterRef) return
    onRegisterRef(el)
    return () => onRegisterRef(null)
  }, [onRegisterRef])

  const isSelected = selectedWorktreeId === worktree.id
  const isPinned = pinnedWorktrees.has(worktree.id)
  const isDragging = draggingId === worktree.id
  const isDropTarget = dragOverId === worktree.id

  // Auto-clear the highlight after the CSS animation finishes
  useEffect(() => {
    if (!isNew) return
    const timer = setTimeout(() => clearNewlyAdded(null), 2000)
    return () => clearTimeout(timer)
  }, [isNew, clearNewlyAdded])

  // Feature 3: worktree context menu
  const [rowState, rowDispatch] = useReducer(rowReducer, {
    menu: null,
    showDeleteConfirm: false,
    dontAskAgain: false,
    isDeleting: false,
  })
  const { menu, showDeleteConfirm, dontAskAgain, isDeleting } = rowState

  // Priority: permission > working > done > active > inactive
  let status: WorktreeStatus = 'inactive'
  if (sessions.some((s) => s.status === 'waiting_input') || hasWaitingAgent) status = 'permission'
  else if (sessions.some((s) => s.status === 'error')) status = 'permission'
  else if (sessions.some((s) => s.status === 'running') || hasWorkingAgent) status = 'working'
  else if (hasDoneAgent) status = 'done'
  else if (sessions.some((s) => s.status === 'idle')) status = 'active'

  const runDeleteWorktree = async (skipFutureConfirmations = false) => {
    if (deleteInFlightRef.current) return

    deleteInFlightRef.current = true
    rowDispatch({ type: 'SET_DELETING', value: true })
    try {
      await removeWorktree(worktree.projectId, worktree.id)
      if (skipFutureConfirmations) setSkipDeleteConfirm(true)
      rowDispatch({ type: 'HIDE_DELETE_CONFIRM' })
    } catch (err) {
      console.error('[WorktreeRow] removeWorktree failed:', err)
      flash('error', cleanIpcError(err, t('deleteWorktreeFailed')), 5_000)
    } finally {
      deleteInFlightRef.current = false
      rowDispatch({ type: 'SET_DELETING', value: false })
    }
  }

  const requestDeleteWorktree = () => {
    if (deleteInFlightRef.current) return
    if (skipDeleteConfirm) {
      void runDeleteWorktree()
    } else {
      rowDispatch({ type: 'SHOW_DELETE_CONFIRM' })
    }
  }

  const worktreeMenuItems: ContextMenuItem[] = [
    {
      label: isPinned ? t('contextMenuUnpin') : t('contextMenuPin'),
      onClick: () => togglePinWorktree(worktree.id)
    },
    {
      label: t('contextMenuCopyBranch'),
      onClick: () => navigator.clipboard.writeText(worktree.branch)
    },
    { label: '---', onClick: () => {} },
    {
      label: t('contextMenuDeleteWorktree'),
      danger: true,
      disabled: worktree.isMain,
      onClick: requestDeleteWorktree
    }
  ]

  return (
    <>
      <div
        ref={rowRef}
        className={[
          'worktree-row',
          isSelected ? 'selected' : '',
          isDragging ? 'worktree-row--dragging' : '',
          isDropTarget ? 'worktree-row--drop-target' : '',
          isNew ? 'worktree-row--new' : '',
          isFocused ? 'worktree-row--keyboard-focused' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        role="option"
        aria-selected={isSelected}
        aria-busy={isDeleting}
        tabIndex={isFocused ? 0 : -1}
        draggable={draggable && !isDeleting}
        data-worktree-id={worktree.id}
        onClick={() => {
          if (!isDeleting) selectWorktree(worktree.projectId, worktree.id)
        }}
        onDoubleClick={() => {
          if (!isDeleting) setMissionControlActive(false)
        }}
        onKeyDown={(e) => {
          if (isDeleting) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            selectWorktree(worktree.projectId, worktree.id)
          } else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && !worktree.isMain && e.currentTarget === e.target) {
            e.preventDefault()
            requestDeleteWorktree()
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (isDeleting) return
          rowDispatch({ type: 'OPEN_MENU', x: e.clientX, y: e.clientY })
        }}
      >
        <Tooltip
          content={
            status === 'permission'
              ? t('worktreeStatusPermission')
              : status === 'working'
                ? t('worktreeStatusWorking')
                : status === 'done'
                  ? t('worktreeStatusDone')
                  : status === 'active'
                    ? t('worktreeStatusActive')
                    : t('worktreeStatusNone')
          }
          position="right"
        >
          <StatusDot status={status} count={sessions.length + agentTerminalCount} />
        </Tooltip>
        <div className="worktree-name-stack">
          <span className="worktree-branch-name">
            {worktreeName(worktree.path, worktree.branch)}
          </span>
          <span className="worktree-branch-secondary">
            <IconGitBranch size={9} />
            <span>{projectName ? `${projectName} / ${worktree.branch}` : worktree.branch}</span>
          </span>
        </div>
        <div className="worktree-row-actions">
          {isDeleting ? (
            <Spinner size="sm" />
          ) : (
            <>
              <PrIcon worktreePath={worktree.path} />
              {worktree.isMain && (
                <Tooltip content={t('worktreeMain')} position="top">
                  <span className="worktree-badge">{t('worktreeMainBadge')}</span>
                </Tooltip>
              )}

              {/* Feature 1: pin / star button */}
              <Tooltip content={isPinned ? t('worktreeUnpinTooltip') : t('worktreePinTooltip')} position="right">
                <button
                  className={`worktree-pin${isPinned ? ' pinned' : ''}`}
                  aria-label={isPinned ? t('worktreeUnpinTooltip') : t('worktreePinTooltip')}
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePinWorktree(worktree.id)
                  }}
                >
                  {isPinned ? '★' : '☆'}
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Feature 3: worktree context menu */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={worktreeMenuItems}
          onClose={() => rowDispatch({ type: 'CLOSE_MENU' })}
        />
      )}

      {showDeleteConfirm && (
        <div
          className="dialog-overlay"
          onClick={() => {
            if (!isDeleting) rowDispatch({ type: 'HIDE_DELETE_CONFIRM' })
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-worktree-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-worktree-title">{t('deleteWorktreeTitle')}</h2>
            <p className="dialog-body-text">
              {t('deleteWorktreeBody', { branch: worktree.branch })}
            </p>
            <Checkbox
              checked={dontAskAgain}
              onChange={(checked) => rowDispatch({ type: 'SET_DONT_ASK', value: checked })}
              disabled={isDeleting}
              label={t('deleteWorktreeDontAsk')}
            />
            <div className="dialog-actions">
              {/* autoFocus the cancel button - the safe non-destructive action */}
              <Button
                autoFocus
                disabled={isDeleting}
                onClick={() => rowDispatch({ type: 'HIDE_DELETE_CONFIRM' })}
              >
                {t('cancel', { ns: 'common' })}
              </Button>
              <Button
                variant="danger"
                loading={isDeleting}
                onClick={() => {
                  void runDeleteWorktree(dontAskAgain)
                }}
              >
                {t('deleteWorktreeConfirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
