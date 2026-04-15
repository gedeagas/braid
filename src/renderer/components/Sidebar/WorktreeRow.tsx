import { useReducer, useEffect } from 'react'
import type { Worktree, SessionStatus } from '@/types'
import { StatusDot } from './StatusDot'
import { PrIcon } from './PrIcon'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { Tooltip } from '@/components/shared/Tooltip'
import { Checkbox } from '@/components/ui'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { useSessionsForWorktree } from '@/store/sessions'
import { useTranslation } from 'react-i18next'
import { IconGitBranch } from '@/components/shared/icons'
import { worktreeName } from '@/lib/branchValidation'

interface Props {
  worktree: Worktree
  dragOverId: string | null
  draggingId: string | null
  isNew?: boolean
}

type RowState = { menu: { x: number; y: number } | null; showDeleteConfirm: boolean; dontAskAgain: boolean }
type RowAction =
  | { type: 'OPEN_MENU'; x: number; y: number }
  | { type: 'CLOSE_MENU' }
  | { type: 'SHOW_DELETE_CONFIRM' }
  | { type: 'HIDE_DELETE_CONFIRM' }
  | { type: 'SET_DONT_ASK'; value: boolean }

function rowReducer(state: RowState, action: RowAction): RowState {
  switch (action.type) {
    case 'OPEN_MENU': return { ...state, menu: { x: action.x, y: action.y } }
    case 'CLOSE_MENU': return { ...state, menu: null }
    case 'SHOW_DELETE_CONFIRM': return { ...state, showDeleteConfirm: true }
    case 'HIDE_DELETE_CONFIRM': return { ...state, showDeleteConfirm: false }
    case 'SET_DONT_ASK': return { ...state, dontAskAgain: action.value }
  }
}

export function WorktreeRow({ worktree, dragOverId, draggingId, isNew }: Props) {
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)
  const pinnedWorktrees = useUIStore((s) => s.pinnedWorktrees)
  const togglePinWorktree = useUIStore((s) => s.togglePinWorktree)
  const removeWorktree = useProjectsStore((s) => s.removeWorktree)
  const skipDeleteConfirm = useUIStore((s) => s.skipDeleteWorktreeConfirm)
  const setSkipDeleteConfirm = useUIStore((s) => s.setSkipDeleteWorktreeConfirm)
  const sessions = useSessionsForWorktree(worktree.id)
  const { t } = useTranslation('sidebar')

  const clearNewlyAdded = useUIStore((s) => s.setNewlyAddedWorktreeId)

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
  const [rowState, rowDispatch] = useReducer(rowReducer, { menu: null, showDeleteConfirm: false, dontAskAgain: false })
  const { menu, showDeleteConfirm, dontAskAgain } = rowState

  let status: SessionStatus = 'inactive'
  if (sessions.some((s) => s.status === 'running')) status = 'running'
  else if (sessions.some((s) => s.status === 'waiting_input')) status = 'waiting_input'
  else if (sessions.some((s) => s.status === 'error')) status = 'error'
  else if (sessions.some((s) => s.status === 'idle')) status = 'idle'

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
      onClick: () => {
        if (skipDeleteConfirm) {
          removeWorktree(worktree.projectId, worktree.id)
        } else {
          rowDispatch({ type: 'SHOW_DELETE_CONFIRM' })
        }
      }
    }
  ]

  return (
    <>
      <div
        className={[
          'worktree-row',
          isSelected ? 'selected' : '',
          isDragging ? 'worktree-row--dragging' : '',
          isDropTarget ? 'worktree-row--drop-target' : '',
          isNew ? 'worktree-row--new' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        role="option"
        aria-selected={isSelected}
        tabIndex={0}
        draggable
        data-worktree-id={worktree.id}
        onClick={() => selectWorktree(worktree.projectId, worktree.id)}
        onDoubleClick={() => setMissionControlActive(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            selectWorktree(worktree.projectId, worktree.id)
          } else if (e.key === 'Delete' && !worktree.isMain) {
            e.preventDefault()
            if (skipDeleteConfirm) {
              removeWorktree(worktree.projectId, worktree.id)
            } else {
              rowDispatch({ type: 'SHOW_DELETE_CONFIRM' })
            }
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          rowDispatch({ type: 'OPEN_MENU', x: e.clientX, y: e.clientY })
        }}
      >
        <Tooltip
          content={
            status === 'running'
              ? t('worktreeStatusRunning')
              : status === 'waiting_input'
                ? t('worktreeStatusWaiting')
                : status === 'error'
                  ? t('worktreeStatusError')
                  : status === 'idle'
                    ? t('worktreeStatusIdle')
                    : t('worktreeStatusNone')
          }
          position="right"
        >
          <StatusDot status={status} count={sessions.length} />
        </Tooltip>
        <div className="worktree-name-stack">
          <span className="worktree-branch-name">
            {worktreeName(worktree.path, worktree.branch)}
          </span>
          <span className="worktree-branch-secondary">
            <IconGitBranch size={9} />
            <span>{worktree.branch}</span>
          </span>
        </div>
        <div className="worktree-row-actions">
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
        <div className="dialog-overlay" onClick={() => rowDispatch({ type: 'HIDE_DELETE_CONFIRM' })}>
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
              label={t('deleteWorktreeDontAsk')}
            />
            <div className="dialog-actions">
              {/* autoFocus the cancel button — the safe non-destructive action */}
              <button className="btn" autoFocus onClick={() => rowDispatch({ type: 'HIDE_DELETE_CONFIRM' })}>
                {t('cancel', { ns: 'common' })}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (dontAskAgain) setSkipDeleteConfirm(true)
                  rowDispatch({ type: 'HIDE_DELETE_CONFIRM' })
                  removeWorktree(worktree.projectId, worktree.id)
                }}
              >
                {t('deleteWorktreeConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
