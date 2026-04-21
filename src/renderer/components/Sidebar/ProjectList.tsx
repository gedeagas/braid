import { useMemo, useState, useReducer, useRef, useEffect, useCallback } from 'react'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { ProjectGroupRow } from './ProjectGroupRow'
import type { Project, Worktree } from '@/types'
import { useTranslation } from 'react-i18next'
import { MIME_PROJECT } from '@/lib/appBrand'

interface Props {
  onAddWorktree: (projectId: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function buildOrderedWorktrees(
  project: Project,
  worktreeOrders: Record<string, string[]>,
  pinnedWorktrees: Set<string>
): Worktree[] {
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
}

// ─── Nav types ────────────────────────────────────────────────────────────────

type NavItem =
  | { kind: 'project'; projectId: string }
  | { kind: 'worktree'; projectId: string; worktreeId: string }

interface NavState { focusedIndex: number | null }
type NavAction =
  | { type: 'NAV_NEXT'; length: number }
  | { type: 'NAV_PREV' }
  | { type: 'NAV_SET'; index: number | null }

function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'NAV_NEXT':
      return { focusedIndex: state.focusedIndex === null ? 0 : Math.min(state.focusedIndex + 1, action.length - 1) }
    case 'NAV_PREV':
      return { focusedIndex: state.focusedIndex === null ? 0 : Math.max(state.focusedIndex - 1, 0) }
    case 'NAV_SET':
      return { focusedIndex: action.index }
  }
}

// ─── ProjectList ──────────────────────────────────────────────────────────────

export function ProjectList({ onAddWorktree }: Props) {
  const projects = useProjectsStore((s) => s.projects)
  const projectOrder = useUIStore((s) => s.projectOrder)
  const reorderProjectsById = useUIStore((s) => s.reorderProjectsById)
  const expandedProjects = useUIStore((s) => s.expandedProjects)
  const toggleProject = useUIStore((s) => s.toggleProject)
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const worktreeOrders = useUIStore((s) => s.worktreeOrders)
  const pinnedWorktrees = useUIStore((s) => s.pinnedWorktrees)
  const { t: tSidebar } = useTranslation('sidebar')

  const [projDraggingId, setProjDraggingId] = useState<string | null>(null)
  const [projDragOverId, setProjDragOverId] = useState<string | null>(null)
  const [navState, navDispatch] = useReducer(navReducer, { focusedIndex: null })
  const { focusedIndex } = navState

  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())

  const handleRegisterRef = useCallback((key: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(key, el)
    else rowRefs.current.delete(key)
  }, [])

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

  // Flat navigable list of all visible items
  const navItems = useMemo((): NavItem[] => {
    const items: NavItem[] = []
    for (const project of orderedProjects) {
      items.push({ kind: 'project', projectId: project.id })
      if (expandedProjects.has(project.id)) {
        const wts = buildOrderedWorktrees(project, worktreeOrders, pinnedWorktrees)
        for (const wt of wts) {
          items.push({ kind: 'worktree', projectId: project.id, worktreeId: wt.id })
        }
      }
    }
    return items
  }, [orderedProjects, expandedProjects, worktreeOrders, pinnedWorktrees])

  // Scroll focused item into view and move DOM focus to match
  useEffect(() => {
    if (focusedIndex === null) return
    const item = navItems[focusedIndex]
    if (!item) return
    const key = item.kind === 'worktree' ? `worktree:${item.worktreeId}` : `project:${item.projectId}`
    const el = rowRefs.current.get(key)
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    el.focus({ preventScroll: true })
  }, [focusedIndex, navItems])

  // Sync focus to selected worktree on mouse click
  useEffect(() => {
    if (!selectedWorktreeId) return
    const idx = navItems.findIndex((item) => item.kind === 'worktree' && item.worktreeId === selectedWorktreeId)
    if (idx !== -1) navDispatch({ type: 'NAV_SET', index: idx })
  }, [selectedWorktreeId, navItems])

  const focusedItem = focusedIndex !== null ? navItems[focusedIndex] ?? null : null
  const focusedWorktreeId = focusedItem?.kind === 'worktree' ? focusedItem.worktreeId : null
  const focusedProjectId = focusedItem?.kind === 'project' ? focusedItem.projectId : null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('input, button, [role="dialog"]')) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        navDispatch({ type: 'NAV_NEXT', length: navItems.length })
        break
      case 'ArrowUp':
        e.preventDefault()
        navDispatch({ type: 'NAV_PREV' })
        break
      case 'ArrowRight': {
        e.preventDefault()
        if (!focusedItem) break
        if (focusedItem.kind === 'project') {
          if (!expandedProjects.has(focusedItem.projectId)) {
            toggleProject(focusedItem.projectId)
          } else {
            const nextIdx = focusedIndex! + 1
            if (nextIdx < navItems.length) navDispatch({ type: 'NAV_SET', index: nextIdx })
          }
        }
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (!focusedItem) break
        if (focusedItem.kind === 'project') {
          if (expandedProjects.has(focusedItem.projectId)) toggleProject(focusedItem.projectId)
        } else {
          const projIdx = navItems.findIndex(
            (n, i) => i < focusedIndex! && n.kind === 'project' && n.projectId === focusedItem.projectId
          )
          if (projIdx !== -1) navDispatch({ type: 'NAV_SET', index: projIdx })
        }
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (!focusedItem) break
        if (focusedItem.kind === 'worktree') {
          selectWorktree(focusedItem.projectId, focusedItem.worktreeId)
        } else {
          toggleProject(focusedItem.projectId)
        }
        break
      }
    }
  }

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
    <div className="project-list" onKeyDown={handleKeyDown}>
      {orderedProjects.map((project) => (
        <ProjectGroupRow
          key={project.id}
          project={project}
          onAddWorktree={onAddWorktree}
          projDraggingId={projDraggingId}
          projDragOverId={projDragOverId}
          focusedWorktreeId={focusedWorktreeId}
          focusedProjectId={focusedProjectId}
          onRegisterRef={handleRegisterRef}
          onProjDragStart={(_e, id) => { setProjDraggingId(id) }}
          onProjDragOver={(_e, id) => { setProjDragOverId(id) }}
          onProjDragLeave={() => { setProjDragOverId(null) }}
          onProjDrop={(e, toId) => {
            const fromId = e.dataTransfer.getData(MIME_PROJECT)
            if (fromId && toId && fromId !== toId) {
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
    </div>
  )
}
