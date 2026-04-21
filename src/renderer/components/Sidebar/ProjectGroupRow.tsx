import { useMemo, useState, useReducer, useCallback, useEffect } from 'react'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { WorktreeRow } from './WorktreeRow'
import { useProjectNotifyStatus } from '@/hooks/useProjectNotifyStatus'
import * as ipc from '@/lib/ipc'
import type { Project, Worktree } from '@/types'
import { useTranslation } from 'react-i18next'
import { MIME_PROJECT, MIME_WORKTREE } from '@/lib/appBrand'
import { buildOrderedWorktrees } from './ProjectList'

// ─── ProjectAvatar ────────────────────────────────────────────────────────────

function ProjectAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [failed, setFailed] = useState(false)
  const onError = useCallback(() => setFailed(true), [])

  useEffect(() => { setFailed(false) }, [avatarUrl])

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        width={18}
        height={18}
        alt=""
        aria-hidden="true"
        onError={onError}
        className="project-avatar"
      />
    )
  }

  const letter = name.charAt(0).toUpperCase() || '?'
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      className="project-avatar project-avatar--letter"
      aria-hidden="true"
      style={{ background: `hsl(${hue}, 55%, 40%)` }}
    >
      {letter}
    </div>
  )
}

// ─── ProjectGroupRow state ────────────────────────────────────────────────────

type GroupRowState = { menu: { x: number; y: number } | null; wtDraggingId: string | null; wtDragOverId: string | null }
type GroupRowAction =
  | { type: 'OPEN_MENU'; x: number; y: number }
  | { type: 'CLOSE_MENU' }
  | { type: 'WT_DRAG_START'; id: string }
  | { type: 'WT_DRAG_OVER'; id: string }
  | { type: 'WT_DRAG_END' }
  | { type: 'WT_DRAG_OVER_CLEAR' }

function groupRowReducer(state: GroupRowState, action: GroupRowAction): GroupRowState {
  switch (action.type) {
    case 'OPEN_MENU': return { ...state, menu: { x: action.x, y: action.y } }
    case 'CLOSE_MENU': return { ...state, menu: null }
    case 'WT_DRAG_START': return { ...state, wtDraggingId: action.id }
    case 'WT_DRAG_OVER': return { ...state, wtDragOverId: action.id }
    case 'WT_DRAG_OVER_CLEAR': return { ...state, wtDragOverId: null }
    case 'WT_DRAG_END': return { ...state, wtDraggingId: null, wtDragOverId: null }
  }
}

// ─── Per-project row ─────────────────────────────────────────────────────────

export interface ProjectGroupRowProps {
  project: Project
  onAddWorktree: (projectId: string) => void
  projDraggingId: string | null
  projDragOverId: string | null
  onProjDragStart: (e: React.DragEvent, id: string) => void
  onProjDragOver: (e: React.DragEvent, id: string) => void
  onProjDragLeave: () => void
  onProjDrop: (e: React.DragEvent, id: string) => void
  onProjDragEnd: () => void
  focusedWorktreeId: string | null
  focusedProjectId: string | null
  onRegisterRef: (key: string, el: HTMLElement | null) => void
}

export function ProjectGroupRow({
  project,
  onAddWorktree,
  projDraggingId,
  projDragOverId,
  onProjDragStart,
  onProjDragOver,
  onProjDragLeave,
  onProjDrop,
  onProjDragEnd,
  focusedWorktreeId,
  focusedProjectId,
  onRegisterRef
}: ProjectGroupRowProps) {
  const isExpanded = useUIStore((s) => s.expandedProjects.has(project.id))
  const toggleProject = useUIStore((s) => s.toggleProject)
  const projectAvatarVisible = useUIStore((s) => s.projectAvatarVisible)
  const pinnedWorktrees = useUIStore((s) => s.pinnedWorktrees)
  const worktreeOrders = useUIStore((s) => s.worktreeOrders)
  const reorderWorktreesById = useUIStore((s) => s.reorderWorktreesById)
  const newlyAddedWorktreeId = useUIStore((s) => s.newlyAddedWorktreeId)

  const refreshWorktrees = useProjectsStore((s) => s.refreshWorktrees)
  const removeProject = useProjectsStore((s) => s.removeProject)

  const notifyStatus = useProjectNotifyStatus(project.worktrees)
  const [groupState, groupDispatch] = useReducer(groupRowReducer, { menu: null, wtDraggingId: null, wtDragOverId: null })
  const { menu, wtDraggingId, wtDragOverId } = groupState
  const { t } = useTranslation('sidebar')

  const orderedWorktrees = useMemo(
    () => buildOrderedWorktrees(project, worktreeOrders, pinnedWorktrees),
    [project, worktreeOrders, pinnedWorktrees]
  )

  const worktreeIds = useMemo(() => orderedWorktrees.map((w) => w.id), [orderedWorktrees])

  // Stable per-worktree ref callbacks — avoids creating a new closure per render
  // (which would trigger WorktreeRow's useEffect([onRegisterRef]) on every render)
  const worktreeRegisterRefs = useMemo(
    () => new Map(orderedWorktrees.map((wt) => [
      wt.id,
      (el: HTMLElement | null) => onRegisterRef(`worktree:${wt.id}`, el)
    ])),
    [orderedWorktrees, onRegisterRef]
  )

  const isDragging = projDraggingId === project.id
  const isDropTarget = projDragOverId === project.id
  const isHeaderFocused = focusedProjectId === project.id

  const projectMenuItems: ContextMenuItem[] = [
    { label: t('contextMenuAddWorktree'), onClick: () => onAddWorktree(project.id) },
    { label: t('contextMenuRefreshWorktrees'), onClick: () => refreshWorktrees(project.id) },
    { label: t('contextMenuOpenInFinder'), onClick: () => ipc.shell.showItemInFolder(project.path) },
    { label: '---', onClick: () => {} },
    { label: t('contextMenuRemoveProject'), danger: true, onClick: () => removeProject(project.id) }
  ]

  return (
    <div
      className={[
        'project-group',
        isDragging ? 'project-group--dragging' : '',
        isDropTarget ? 'project-group--drop-target' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      draggable
      data-project-id={project.id}
      onDragStart={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('[data-worktree-id]')) return
        e.dataTransfer.setData(MIME_PROJECT, project.id)
        e.dataTransfer.effectAllowed = 'move'
        onProjDragStart(e, project.id)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(MIME_WORKTREE)) return
        if (!e.dataTransfer.types.includes(MIME_PROJECT)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onProjDragOver(e, project.id)
      }}
      onDragLeave={(e) => {
        if (e.dataTransfer.types.includes(MIME_WORKTREE)) return
        onProjDragLeave()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes(MIME_WORKTREE)) return
        if (!e.dataTransfer.types.includes(MIME_PROJECT)) return
        e.preventDefault()
        onProjDrop(e, project.id)
      }}
      onDragEnd={onProjDragEnd}
    >
      <div
        ref={(el) => onRegisterRef(`project:${project.id}`, el)}
        className={[
          'project-header',
          isHeaderFocused ? 'project-header--keyboard-focused' : ''
        ].filter(Boolean).join(' ')}
        tabIndex={-1}
        onClick={() => { if (!isDragging) toggleProject(project.id) }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          groupDispatch({ type: 'OPEN_MENU', x: e.clientX, y: e.clientY })
        }}
      >
        <span className={`project-chevron ${isExpanded ? 'expanded' : ''}`}>&#9654;</span>
        {projectAvatarVisible && <ProjectAvatar name={project.name} avatarUrl={project.avatarUrl} />}
        <span className="project-name">{project.name}</span>

        {!isExpanded && notifyStatus && (
          <span className={`project-notify-dot ${notifyStatus}`} />
        )}

        <span className="project-actions">
          <span className="project-count">{project.worktrees.length}</span>
          <Tooltip content={t('projectSettings')} position="right">
            <button
              className="btn-icon btn-icon-sm"
              onClick={(e) => {
                e.stopPropagation()
                useUIStore.getState().openSettings(`project:${project.id}`)
              }}
            >
              ⚙
            </button>
          </Tooltip>
          <Tooltip content={t('addWorktree')} position="right">
            <button
              className="btn-icon btn-icon-sm"
              data-tour="add-worktree"
              onClick={(e) => {
                e.stopPropagation()
                onAddWorktree(project.id)
              }}
            >
              +
            </button>
          </Tooltip>
        </span>
      </div>

      {isExpanded && (
        <div
          onDragStart={(e) => {
            e.stopPropagation()
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-worktree-id]')
            if (!row) return
            const id = row.dataset.worktreeId!
            e.dataTransfer.setData(MIME_WORKTREE, id)
            e.dataTransfer.effectAllowed = 'move'
            groupDispatch({ type: 'WT_DRAG_START', id })
          }}
          onDragOver={(e) => {
            e.stopPropagation()
            if (!e.dataTransfer.types.includes(MIME_WORKTREE)) return
            if (e.dataTransfer.types.includes(MIME_PROJECT)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-worktree-id]')
            if (row) groupDispatch({ type: 'WT_DRAG_OVER', id: row.dataset.worktreeId! })
          }}
          onDragLeave={(e) => {
            e.stopPropagation()
            const related = e.relatedTarget as HTMLElement | null
            if (!related || !e.currentTarget.contains(related)) {
              groupDispatch({ type: 'WT_DRAG_OVER_CLEAR' })
            }
          }}
          onDrop={(e) => {
            e.stopPropagation()
            e.preventDefault()
            const fromId = e.dataTransfer.getData(MIME_WORKTREE)
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-worktree-id]')
            const toId = row?.dataset.worktreeId
            if (fromId && toId && fromId !== toId) {
              reorderWorktreesById(project.id, worktreeIds, fromId, toId)
            }
            groupDispatch({ type: 'WT_DRAG_END' })
          }}
          onDragEnd={() => {
            groupDispatch({ type: 'WT_DRAG_END' })
          }}
        >
          {orderedWorktrees.map((wt) => (
            <WorktreeRow
              key={wt.id}
              worktree={wt}
              draggingId={wtDraggingId}
              dragOverId={wtDragOverId}
              isNew={wt.id === newlyAddedWorktreeId}
              isFocused={focusedWorktreeId === wt.id}
              onRegisterRef={worktreeRegisterRefs.get(wt.id)}
            />
          ))}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={projectMenuItems}
          onClose={() => groupDispatch({ type: 'CLOSE_MENU' })}
        />
      )}
    </div>
  )
}
