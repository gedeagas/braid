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

interface Props {
  onAddWorktree: (projectId: string) => void
}

// ─── ProjectAvatar ────────────────────────────────────────────────────────────

function ProjectAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [failed, setFailed] = useState(false)
  const onError = useCallback(() => setFailed(true), [])

  // Reset failed state when avatarUrl changes (e.g. backfill arrives)
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

  // Letter avatar fallback - deterministic color from name
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

interface ProjectGroupRowProps {
  project: Project
  onAddWorktree: (projectId: string) => void
  projDraggingId: string | null
  projDragOverId: string | null
  onProjDragStart: (e: React.DragEvent, id: string) => void
  onProjDragOver: (e: React.DragEvent, id: string) => void
  onProjDragLeave: () => void
  onProjDrop: (e: React.DragEvent, id: string) => void
  onProjDragEnd: () => void
}

function ProjectGroupRow({
  project,
  onAddWorktree,
  projDraggingId,
  projDragOverId,
  onProjDragStart,
  onProjDragOver,
  onProjDragLeave,
  onProjDrop,
  onProjDragEnd
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

  // Ordered worktrees: stored order reconciled with live data, then pins float to top
  const orderedWorktrees = useMemo((): Worktree[] => {
    const storedOrder = worktreeOrders[project.id]
    let base: Worktree[]
    if (storedOrder && storedOrder.length > 0) {
      const map = new Map(project.worktrees.map((w) => [w.id, w]))
      const result: Worktree[] = []
      for (const id of storedOrder) {
        const w = map.get(id)
        if (w) result.push(w)
      }
      for (const w of project.worktrees) {
        if (!result.includes(w)) result.push(w)
      }
      base = result
    } else {
      base = project.worktrees
    }
    return [...base].sort(
      (a, b) => (pinnedWorktrees.has(a.id) ? 0 : 1) - (pinnedWorktrees.has(b.id) ? 0 : 1)
    )
  }, [project.worktrees, worktreeOrders, project.id, pinnedWorktrees])

  // Live visual IDs — passed to store on drop so it doesn't depend on stored order
  const worktreeIds = useMemo(() => orderedWorktrees.map((w) => w.id), [orderedWorktrees])

  const isDragging = projDraggingId === project.id
  const isDropTarget = projDragOverId === project.id

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
        className="project-header"
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

      {/* Worktree list — all drag logic inline, no hooks */}
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
              // Pass live visual order — store splices within this array
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

// ─── ProjectList ──────────────────────────────────────────────────────────────

export function ProjectList({ onAddWorktree }: Props) {
  const projects = useProjectsStore((s) => s.projects)
  const projectOrder = useUIStore((s) => s.projectOrder)
  const reorderProjectsById = useUIStore((s) => s.reorderProjectsById)
  const { t: tSidebar } = useTranslation('sidebar')

  const [projDraggingId, setProjDraggingId] = useState<string | null>(null)
  const [projDragOverId, setProjDragOverId] = useState<string | null>(null)

  // Reconcile live projects with the stored display order
  const orderedProjects = useMemo(() => {
    if (projectOrder.length === 0) return projects
    const map = new Map(projects.map((p) => [p.id, p]))
    const result: Project[] = []
    for (const id of projectOrder) {
      const p = map.get(id)
      if (p) result.push(p)
    }
    for (const p of projects) {
      if (!result.includes(p)) result.push(p)
    }
    return result
  }, [projects, projectOrder])

  // Live visual IDs — passed to store on drop
  const projectIds = useMemo(() => orderedProjects.map((p) => p.id), [orderedProjects])

  if (projects.length === 0) {
    return (
      <div className="sidebar-empty-state">
        <div className="sidebar-empty-state-text">{tSidebar('noProjects')}</div>
        <div className="sidebar-empty-state-hint">{tSidebar('noProjectsHint')}</div>
      </div>
    )
  }

  return (
    <>
      {orderedProjects.map((project) => (
        <ProjectGroupRow
          key={project.id}
          project={project}
          onAddWorktree={onAddWorktree}
          projDraggingId={projDraggingId}
          projDragOverId={projDragOverId}
          onProjDragStart={(_e, id) => {
            setProjDraggingId(id)
          }}
          onProjDragOver={(_e, id) => {
            setProjDragOverId(id)
          }}
          onProjDragLeave={() => {
            setProjDragOverId(null)
          }}
          onProjDrop={(e, toId) => {
            const fromId = e.dataTransfer.getData(MIME_PROJECT)
            if (fromId && toId && fromId !== toId) {
              // Pass live visual order — store splices within this array
              reorderProjectsById(projectIds, fromId, toId)
            }
            setProjDraggingId(null)
            setProjDragOverId(null)
          }}
          onProjDragEnd={() => {
            setProjDraggingId(null)
            setProjDragOverId(null)
          }}
        />
      ))}
    </>
  )
}
