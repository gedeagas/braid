import { useMemo, useState, useReducer, useRef, useEffect, useCallback } from 'react'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'
import { usePrCacheStore, type PrStatus } from '@/store/prCache'
import { ProjectGroupRow } from './ProjectGroupRow'
import { WorktreeRow } from './WorktreeRow'
import type { AgentSession, Project, Worktree, WorktreeStatus } from '@/types'
import { useTranslation } from 'react-i18next'
import { MIME_PROJECT } from '@/lib/appBrand'
import { IconClose } from '@/components/shared/icons'
import { buildVisibleProjects } from './ProjectListFiltering'
import { worktreeName } from '@/lib/branchValidation'
import type { AgentStatusEntry } from '@/lib/agentStatus'

interface Props {
  onAddWorktree: (projectId: string) => void
}

interface WorktreeListItem {
  project: Project
  worktree: Worktree
  status: WorktreeStatus
  pr: PrStatus | null | undefined
  activityAt: number
  manualIndex: number
}

type PrGroup = 'open' | 'draft' | 'mergedClosed' | 'none' | 'checking'

function computeWorktreeStatus(sessions: AgentSession[], terminalStatuses: AgentStatusEntry[]): WorktreeStatus {
  if (
    sessions.some((s) => s.status === 'waiting_input' || s.status === 'error') ||
    terminalStatuses.some((status) => status.state === 'waiting' || status.state === 'blocked')
  ) {
    return 'permission'
  }
  if (
    sessions.some((s) => s.status === 'running') ||
    terminalStatuses.some((status) => status.state === 'working')
  ) {
    return 'working'
  }
  if (terminalStatuses.some((status) => status.state === 'done')) return 'done'
  if (sessions.some((s) => s.status === 'idle')) return 'active'
  return 'inactive'
}

function computeActivityAt(project: Project, worktree: Worktree, sessions: AgentSession[], terminalStatuses: AgentStatusEntry[]): number {
  let activityAt = project.createdAt
  for (const session of sessions) {
    activityAt = Math.max(
      activityAt,
      session.runStartedAt ?? 0,
      session.runCompletedAt ?? 0,
      session.createdAt,
      ...session.messages.map((message) => message.timestamp)
    )
  }
  for (const status of terminalStatuses) {
    activityAt = Math.max(activityAt, status.updatedAt)
  }
  if (worktree.isMain) activityAt = Math.max(activityAt, project.createdAt)
  return activityAt
}

function compareWorktreeItems(a: WorktreeListItem, b: WorktreeListItem, sortBy: 'manual' | 'recent' | 'name'): number {
  if (sortBy === 'recent') {
    return b.activityAt - a.activityAt || a.manualIndex - b.manualIndex
  }
  if (sortBy === 'name') {
    return (
      worktreeName(a.worktree.path, a.worktree.branch)
        .localeCompare(worktreeName(b.worktree.path, b.worktree.branch), undefined, { sensitivity: 'base' }) ||
      a.project.name.localeCompare(b.project.name, undefined, { sensitivity: 'base' })
    )
  }
  return a.manualIndex - b.manualIndex
}

function prGroupFor(pr: PrStatus | null | undefined): PrGroup {
  if (pr === undefined) return 'checking'
  if (pr === null) return 'none'
  const state = pr.state.toLowerCase()
  if (state === 'merged' || state === 'closed') return 'mergedClosed'
  if (pr.isDraft) return 'draft'
  return 'open'
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
  const sidebarGroupBy = useUIStore((s) => s.sidebarGroupBy)
  const sidebarSortBy = useUIStore((s) => s.sidebarSortBy)
  const sidebarFilterQuery = useUIStore((s) => s.sidebarFilterQuery)
  const sidebarHideSleeping = useUIStore((s) => s.sidebarHideSleeping)
  const sidebarHideDefaultBranch = useUIStore((s) => s.sidebarHideDefaultBranch)
  const clearSidebarFilters = useUIStore((s) => s.clearSidebarFilters)
  const bigTerminalsByWorktree = useUIStore((s) => s.bigTerminalsByWorktree)
  const bigTerminalStatusById = useUIStore((s) => s.bigTerminalStatusById)
  const sessions = useSessionsStore((s) => s.sessions)
  const prCache = usePrCacheStore((s) => s.cache)
  const fetchPr = usePrCacheStore((s) => s.fetchPr)
  const { t: tSidebar } = useTranslation('sidebar')

  const [projDraggingId, setProjDraggingId] = useState<string | null>(null)
  const [projDragOverId, setProjDragOverId] = useState<string | null>(null)
  const [navState, navDispatch] = useReducer(navReducer, { focusedIndex: null })
  const { focusedIndex } = navState

  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)

  const handleRegisterRef = useCallback((key: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(key, el)
    else rowRefs.current.delete(key)
  }, [])

  const sessionsByWorktree = useMemo(() => {
    const map = new Map<string, AgentSession[]>()
    for (const session of Object.values(sessions)) {
      const list = map.get(session.worktreeId)
      if (list) list.push(session)
      else map.set(session.worktreeId, [session])
    }
    return map
  }, [sessions])

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

  const awakeWorktreeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [worktreeId, worktreeSessions] of sessionsByWorktree) {
      if (worktreeSessions.some((session) => session.status !== 'inactive')) ids.add(worktreeId)
    }
    for (const [worktreeId, tabs] of Object.entries(bigTerminalsByWorktree)) {
      if (tabs.some((tab) => bigTerminalStatusById[tab.id])) ids.add(worktreeId)
    }
    return ids
  }, [sessionsByWorktree, bigTerminalsByWorktree, bigTerminalStatusById])

  const hasActiveFilters = (
    sidebarGroupBy !== 'project' ||
    sidebarSortBy !== 'manual' ||
    sidebarFilterQuery.trim() !== '' ||
    sidebarHideSleeping ||
    sidebarHideDefaultBranch
  )
  const hasSearchQuery = sidebarFilterQuery.trim() !== ''

  const visibleProjects = useMemo(
    () => buildVisibleProjects(orderedProjects, {
      query: sidebarFilterQuery,
      hideSleeping: sidebarHideSleeping,
      hideDefaultBranch: sidebarHideDefaultBranch,
      awakeWorktreeIds,
      worktreeOrders,
      pinnedWorktrees,
    }),
    [
      orderedProjects,
      sidebarFilterQuery,
      sidebarHideSleeping,
      sidebarHideDefaultBranch,
      awakeWorktreeIds,
      worktreeOrders,
      pinnedWorktrees,
    ]
  )

  const worktreeItems = useMemo((): WorktreeListItem[] => {
    let manualIndex = 0
    const items: WorktreeListItem[] = []
    for (const { project, worktrees } of visibleProjects) {
      for (const worktree of worktrees) {
        const worktreeSessions = sessionsByWorktree.get(worktree.id) ?? []
        const terminalTabs = bigTerminalsByWorktree[worktree.id] ?? []
        const terminalStatuses = terminalTabs
          .map((tab) => bigTerminalStatusById[tab.id])
          .filter((status): status is AgentStatusEntry => Boolean(status))
        const prEntry = prCache[worktree.path]
        items.push({
          project,
          worktree,
          status: computeWorktreeStatus(worktreeSessions, terminalStatuses),
          pr: !prEntry || prEntry.fetchedAt === 0 ? undefined : prEntry.data,
          activityAt: computeActivityAt(project, worktree, worktreeSessions, terminalStatuses),
          manualIndex,
        })
        manualIndex++
      }
    }
    return items
  }, [visibleProjects, sessionsByWorktree, bigTerminalsByWorktree, bigTerminalStatusById, prCache])

  useEffect(() => {
    if (sidebarGroupBy !== 'pr') return
    for (const item of worktreeItems) {
      const entry = prCache[item.worktree.path]
      if (!entry || entry.fetchedAt === 0) void fetchPr(item.worktree.path)
    }
  }, [sidebarGroupBy, worktreeItems, prCache, fetchPr])

  const sortedWorktreeItems = useMemo(
    () => [...worktreeItems].sort((a, b) => compareWorktreeItems(a, b, sidebarSortBy)),
    [worktreeItems, sidebarSortBy]
  )

  const visibleProjectsForRender = useMemo(() => {
    if (sidebarSortBy === 'manual') return visibleProjects
    const itemsByProject = new Map<string, WorktreeListItem[]>()
    for (const item of sortedWorktreeItems) {
      const items = itemsByProject.get(item.project.id)
      if (items) items.push(item)
      else itemsByProject.set(item.project.id, [item])
    }
    const projectsForRender = visibleProjects.map(({ project, worktrees }) => ({
      project,
      worktrees: itemsByProject.get(project.id)?.map((item) => item.worktree) ?? worktrees,
    }))
    if (sidebarSortBy === 'recent') {
      projectsForRender.sort((a, b) => {
        const aRecent = itemsByProject.get(a.project.id)?.[0]?.activityAt ?? a.project.createdAt
        const bRecent = itemsByProject.get(b.project.id)?.[0]?.activityAt ?? b.project.createdAt
        return bRecent - aRecent
      })
    } else if (sidebarSortBy === 'name') {
      projectsForRender.sort((a, b) => a.project.name.localeCompare(b.project.name, undefined, { sensitivity: 'base' }))
    }
    return projectsForRender
  }, [visibleProjects, sortedWorktreeItems, sidebarSortBy])

  // Flat navigable list of all visible items
  const navItems = useMemo((): NavItem[] => {
    const items: NavItem[] = []
    if (sidebarGroupBy !== 'project') {
      for (const item of sortedWorktreeItems) {
        items.push({ kind: 'worktree', projectId: item.project.id, worktreeId: item.worktree.id })
      }
      return items
    }
    for (const { project, worktrees } of visibleProjectsForRender) {
      items.push({ kind: 'project', projectId: project.id })
      if (expandedProjects.has(project.id) || hasSearchQuery) {
        for (const wt of worktrees) {
          items.push({ kind: 'worktree', projectId: project.id, worktreeId: wt.id })
        }
      }
    }
    return items
  }, [sidebarGroupBy, sortedWorktreeItems, visibleProjectsForRender, expandedProjects, hasSearchQuery])

  // navItemsRef lets the click-sync effect below read current items without
  // triggering a re-run when the list rebuilds (e.g. on expand/collapse)
  const navItemsRef = useRef(navItems)
  navItemsRef.current = navItems

  // Scroll focused item into view and move DOM focus — but only if the sidebar
  // already owns focus, so we never steal focus from the chat textarea.
  // navItems is intentionally omitted: rowRefs is always current via ref, so
  // only focusedIndex changes should trigger scrolling.
  useEffect(() => {
    if (focusedIndex === null) return
    const item = navItemsRef.current[focusedIndex]
    if (!item) return
    const key = item.kind === 'worktree' ? `worktree:${item.worktreeId}` : `project:${item.projectId}`
    const el = rowRefs.current.get(key)
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    if (containerRef.current?.contains(document.activeElement)) {
      el.focus({ preventScroll: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedIndex])

  // Sync keyboard focus to selected worktree on mouse click.
  // Depends only on selectedWorktreeId — NOT navItems — so that
  // expand/collapse rebuilding navItems doesn't reset nav position.
  useEffect(() => {
    if (!selectedWorktreeId) return
    const idx = navItemsRef.current.findIndex(
      (item) => item.kind === 'worktree' && item.worktreeId === selectedWorktreeId
    )
    if (idx !== -1) navDispatch({ type: 'NAV_SET', index: idx })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorktreeId])

  const focusedItem = focusedIndex !== null ? navItems[focusedIndex] ?? null : null
  const focusedWorktreeId = focusedItem?.kind === 'worktree' ? focusedItem.worktreeId : null
  const focusedProjectId = focusedItem?.kind === 'project' ? focusedItem.projectId : null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, [role="dialog"]')) return

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
        if (!focusedItem || focusedIndex === null) break
        if (focusedItem.kind === 'project') {
          if (!expandedProjects.has(focusedItem.projectId)) {
            toggleProject(focusedItem.projectId)
          } else {
            const nextIdx = focusedIndex + 1
            if (nextIdx < navItems.length) navDispatch({ type: 'NAV_SET', index: nextIdx })
          }
        }
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (!focusedItem || focusedIndex === null) break
        if (focusedItem.kind === 'project') {
          if (expandedProjects.has(focusedItem.projectId)) toggleProject(focusedItem.projectId)
        } else {
          const projIdx = navItems.findIndex(
            (n, i) => i < focusedIndex && n.kind === 'project' && n.projectId === focusedItem.projectId
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
  const canReorder = !hasActiveFilters
  const flatWorktreeRegisterRefs = useMemo(
    () => new Map(sortedWorktreeItems.map((item) => [
      item.worktree.id,
      (el: HTMLElement | null) => handleRegisterRef(`worktree:${item.worktree.id}`, el)
    ])),
    [sortedWorktreeItems, handleRegisterRef]
  )

  const worktreeSections = useMemo(() => {
    if (sidebarGroupBy === 'status') {
      return [
        { id: 'working', label: tSidebar('groupStatusWorking'), items: sortedWorktreeItems.filter((item) => item.status === 'working') },
        { id: 'permission', label: tSidebar('groupStatusPermission'), items: sortedWorktreeItems.filter((item) => item.status === 'permission') },
        { id: 'done', label: tSidebar('groupStatusDone'), items: sortedWorktreeItems.filter((item) => item.status === 'done') },
        { id: 'active', label: tSidebar('groupStatusActive'), items: sortedWorktreeItems.filter((item) => item.status === 'active') },
        { id: 'inactive', label: tSidebar('groupStatusSleeping'), items: sortedWorktreeItems.filter((item) => item.status === 'inactive') },
      ].filter((section) => section.items.length > 0)
    }
    if (sidebarGroupBy === 'pr') {
      return [
        { id: 'open', label: tSidebar('groupPrOpen'), items: sortedWorktreeItems.filter((item) => prGroupFor(item.pr) === 'open') },
        { id: 'draft', label: tSidebar('groupPrDraft'), items: sortedWorktreeItems.filter((item) => prGroupFor(item.pr) === 'draft') },
        { id: 'mergedClosed', label: tSidebar('groupPrMergedClosed'), items: sortedWorktreeItems.filter((item) => prGroupFor(item.pr) === 'mergedClosed') },
        { id: 'none', label: tSidebar('groupPrNone'), items: sortedWorktreeItems.filter((item) => prGroupFor(item.pr) === 'none') },
        { id: 'checking', label: tSidebar('groupPrChecking'), items: sortedWorktreeItems.filter((item) => prGroupFor(item.pr) === 'checking') },
      ].filter((section) => section.items.length > 0)
    }
    return [{ id: 'none', label: null, items: sortedWorktreeItems }]
  }, [sidebarGroupBy, sortedWorktreeItems, tSidebar])

  if (projects.length === 0) {
    return (
      <div className="sidebar-empty-state">
        <div className="sidebar-empty-state-text">{tSidebar('noProjects')}</div>
        <div className="sidebar-empty-state-hint">{tSidebar('noProjectsHint')}</div>
      </div>
    )
  }

  if (visibleProjects.length === 0 || (sidebarGroupBy !== 'project' && sortedWorktreeItems.length === 0)) {
    return (
      <div className="sidebar-empty-state">
        <div className="sidebar-empty-state-text">{tSidebar('noProjectsMatchFilters')}</div>
        <button className="sidebar-empty-clear-btn" onClick={clearSidebarFilters}>
          <IconClose size={8} />
          {tSidebar('clearProjectFilters')}
        </button>
      </div>
    )
  }

  if (sidebarGroupBy !== 'project') {
    return (
      <div ref={containerRef} className="project-list sidebar-flat-worktree-list" onKeyDown={handleKeyDown}>
        {worktreeSections.map((section) => (
          <div key={section.id} className="sidebar-worktree-section">
            {section.label && (
              <div className="sidebar-worktree-section-header">
                <span>{section.label}</span>
                <span>{section.items.length}</span>
              </div>
            )}
            {section.items.map((item) => (
              <WorktreeRow
                key={item.worktree.id}
                worktree={item.worktree}
                draggingId={null}
                dragOverId={null}
                draggable={false}
                projectName={item.project.name}
                isFocused={focusedWorktreeId === item.worktree.id}
                onRegisterRef={flatWorktreeRegisterRefs.get(item.worktree.id)}
              />
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="project-list" onKeyDown={handleKeyDown}>
      {visibleProjectsForRender.map(({ project, worktrees }) => (
        <ProjectGroupRow
          key={project.id}
          project={project}
          worktrees={worktrees}
          forceExpanded={hasSearchQuery}
          canReorder={canReorder}
          showFilteredCount={hasActiveFilters}
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
