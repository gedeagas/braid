import { useState, useEffect, useMemo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import type { SessionColumnId, PrColumnId, SessionCardData, PrCardData, MissionControlTab } from '@/types'
import { useProjectsStore } from '@/store/projects'
import { useSessionsStore } from '@/store/sessions'
import { useUIStore } from '@/store/ui'
import { usePrCacheStore } from '@/store/prCache'
import { useMissionControlStore } from '@/store/missionControl'
import { SESSION_COLUMNS, PR_COLUMNS, assignSessionColumn, assignPrColumn } from '@/lib/kanbanColumns'
import { getSessionTitle } from '@/lib/sessionTitle'
import { IconTerminal, IconGitFork } from '@/components/shared/icons'
import { KanbanColumn } from './KanbanColumn'
import { McFilterBar } from './McFilterBar'
import { isOnline, onOnline } from '@/lib/online'

const POLL_INTERVAL_MS = 30_000

/** Returns a minute-resolution tick that increments every 60s, forcing dependents to re-compute. Paused when inactive. */
function useMinuteTick(active: boolean): number {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 60_000))

  useEffect(() => {
    if (!active) return
    // Refresh immediately when becoming active (may have drifted while paused)
    setTick(Math.floor(Date.now() / 60_000))
    const id = setInterval(() => setTick(Math.floor(Date.now() / 60_000)), 60_000)
    return () => clearInterval(id)
  }, [active])

  return tick
}

function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.toLowerCase()
  return fields.some((f) => f?.toLowerCase().includes(q))
}

function useSessionBoardData(active: boolean): Map<SessionColumnId, SessionCardData[]> {
  const projects = useProjectsStore((s) => s.projects)
  const sessions = useSessionsStore(useShallow((s) => s.sessions))
  const dismissedSessionIds = useMissionControlStore((s) => s.dismissedSessionIds)
  const doneLastClearedAt = useMissionControlStore((s) => s.doneLastClearedAt)
  const filterQuery = useMissionControlStore((s) => s.filterQuery)
  const filterProjectIds = useMissionControlStore((s) => s.filterProjectIds)
  const minuteTick = useMinuteTick(active)

  return useMemo(() => {
    const now = minuteTick * 60_000
    const columns = new Map<SessionColumnId, SessionCardData[]>()
    for (const col of SESSION_COLUMNS) columns.set(col.id as SessionColumnId, [])

    for (const project of projects) {
      if (filterProjectIds.size > 0 && !filterProjectIds.has(project.id)) continue

      for (const wt of project.worktrees) {
        const wtSessions = Object.values(sessions).filter((s) => s.worktreeId === wt.id)

        for (const session of wtSessions) {
          const sessionName = getSessionTitle(session)
          if (filterQuery && !matchesQuery(filterQuery, wt.branch, sessionName, project.name)) continue

          const dismissedAt = dismissedSessionIds.get(session.id) ?? null
          const col = assignSessionColumn(session.status, session.runCompletedAt, dismissedAt, now, doneLastClearedAt)
          columns.get(col)!.push({
            kind: 'session',
            sessionId: session.id,
            sessionName,
            worktreeId: wt.id,
            projectId: project.id,
            projectName: project.name,
            branch: wt.branch,
            status: session.status,
            activity: session.activity,
            runStartedAt: session.runStartedAt,
            column: col,
          })
        }
      }
    }

    return columns
  }, [projects, sessions, dismissedSessionIds, doneLastClearedAt, minuteTick, filterQuery, filterProjectIds])
}

function usePrBoardData(): Map<PrColumnId, PrCardData[]> {
  const projects = useProjectsStore((s) => s.projects)
  const prCache = usePrCacheStore((s) => s.cache)
  const gitStats = useMissionControlStore((s) => s.gitStats)
  const checksStatus = useMissionControlStore((s) => s.checksStatus)
  const filterQuery = useMissionControlStore((s) => s.filterQuery)
  const filterProjectIds = useMissionControlStore((s) => s.filterProjectIds)

  return useMemo(() => {
    const columns = new Map<PrColumnId, PrCardData[]>()
    for (const col of PR_COLUMNS) columns.set(col.id as PrColumnId, [])

    for (const project of projects) {
      if (filterProjectIds.size > 0 && !filterProjectIds.has(project.id)) continue

      for (const wt of project.worktrees) {
        const prEntry = prCache[wt.path]
        if (prEntry?.data) {
          if (filterQuery && !matchesQuery(filterQuery, wt.branch, prEntry.data.title, project.name)) continue

          const prCol = assignPrColumn(prEntry.data.state, prEntry.data.isDraft)
          const stats = gitStats[wt.path] ?? null
          const checks = checksStatus[wt.path] ?? 'none'
          columns.get(prCol)!.push({
            kind: 'pr',
            worktreeId: wt.id,
            projectId: project.id,
            projectName: project.name,
            branch: wt.branch,
            path: wt.path,
            isMain: wt.isMain,
            pr: {
              number: prEntry.data.number,
              title: prEntry.data.title,
              state: prEntry.data.state,
              url: prEntry.data.url,
              isDraft: prEntry.data.isDraft,
            },
            checksStatus: checks,
            changeStats: stats,
            column: prCol,
          })
        }
      }
    }

    return columns
  }, [projects, prCache, gitStats, checksStatus, filterQuery, filterProjectIds])
}

export function MissionControl() {
  const { t } = useTranslation('missionControl')
  const missionControlActive = useUIStore((s) => s.missionControlActive)
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)
  const projects = useProjectsStore((s) => s.projects)
  const setShowAddProject = useUIStore((s) => s.setShowAddProject)

  const refreshAll = useMissionControlStore((s) => s.refreshAll)
  const baseClearDone = useMissionControlStore((s) => s.clearDone)
  const trackPath = usePrCacheStore((s) => s.trackPath)
  const untrackPath = usePrCacheStore((s) => s.untrackPath)

  const [activeTab, setActiveTab] = useState<MissionControlTab>('sessions')

  // Auto-undismiss sessions that go back to running
  const sessions = useSessionsStore(useShallow((s) => s.sessions))
  const dismissedSessionIds = useMissionControlStore((s) => s.dismissedSessionIds)
  const undismissSession = useMissionControlStore((s) => s.undismissSession)

  useEffect(() => {
    for (const id of dismissedSessionIds.keys()) {
      const session = sessions[id]
      if (session && session.status === 'running') {
        undismissSession(id)
      }
    }
  }, [sessions, dismissedSessionIds, undismissSession])

  // Clear Done: reset dismissed error/waiting_input sessions to idle, then clear timestamp
  const clearDone = useCallback(() => {
    for (const [id] of dismissedSessionIds) {
      const session = sessions[id]
      if (session && (session.status === 'error' || session.status === 'waiting_input')) {
        useSessionsStore.setState((s) => {
          const current = s.sessions[id]
          if (!current) return s
          return {
            sessions: {
              ...s.sessions,
              [id]: {
                ...current,
                status: 'idle',
                activity: null,
                runStartedAt: null,
                pendingQuestion: undefined,
                pendingPlanApproval: undefined,
                pendingToolPermission: undefined,
                pendingAuthError: undefined
              }
            }
          }
        })
      }
    }
    baseClearDone()
  }, [sessions, dismissedSessionIds, baseClearDone])

  // Gather all worktree paths for polling
  const worktreePaths = useMemo(
    () => projects.flatMap((p) => p.worktrees.map((w) => w.path)),
    [projects]
  )

  // PR tracking + git/checks polling (paused when hidden)
  useEffect(() => {
    if (!missionControlActive || worktreePaths.length === 0) return

    worktreePaths.forEach((p) => trackPath(p))
    refreshAll(worktreePaths)

    const interval = setInterval(() => {
      if (isOnline()) refreshAll(worktreePaths)
    }, POLL_INTERVAL_MS)
    const unsubOnline = onOnline(() => refreshAll(worktreePaths))

    return () => {
      clearInterval(interval)
      unsubOnline()
      worktreePaths.forEach((p) => untrackPath(p))
    }
  }, [missionControlActive, worktreePaths, trackPath, untrackPath, refreshAll])

  const sessionData = useSessionBoardData(missionControlActive)
  const prData = usePrBoardData()

  const sessionCount = useMemo(
    () => Array.from(sessionData.values()).reduce((sum, cards) => sum + cards.length, 0),
    [sessionData]
  )
  const prCount = useMemo(
    () => Array.from(prData.values()).reduce((sum, cards) => sum + cards.length, 0),
    [prData]
  )

  const clearFilters = useMissionControlStore((s) => s.clearFilters)

  const handleClose = useCallback(() => {
    clearFilters()
    setMissionControlActive(false)
  }, [setMissionControlActive, clearFilters])

  // Escape key dismisses Mission Control (only when visible)
  useEffect(() => {
    if (!missionControlActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [missionControlActive, handleClose])

  const hasProjects = projects.length > 0
  const projectList = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects]
  )

  return (
    <div className="mission-control">
      <div className="mission-control-header">
        <div className="drag-region" />
        <span className="mission-control-title">{t('title')}</span>
        <button className="btn-icon" onClick={handleClose} title={t('close')}>
          ✕
        </button>
      </div>

      {!hasProjects ? (
        <div className="mission-control-empty">
          <p>{t('emptyBoard')}</p>
          <p className="mc-empty-hint">{t('emptyBoardHint')}</p>
          <button
            className="btn-primary"
            onClick={() => setShowAddProject(true)}
          >
            + {t('addProject')}
          </button>
        </div>
      ) : (
        <div className="mc-body">
          <div className="mc-sidebar">
            <button
              className={`mc-sidebar-item${activeTab === 'sessions' ? ' mc-sidebar-item--active' : ''}`}
              onClick={() => setActiveTab('sessions')}
            >
              <IconTerminal size={14} />
              <span>{t('tabSessions')}</span>
              {sessionCount > 0 && <span className="mc-sidebar-count">{sessionCount}</span>}
            </button>
            <button
              className={`mc-sidebar-item${activeTab === 'prs' ? ' mc-sidebar-item--active' : ''}`}
              onClick={() => setActiveTab('prs')}
            >
              <IconGitFork size={14} />
              <span>{t('tabPrs')}</span>
              {prCount > 0 && <span className="mc-sidebar-count">{prCount}</span>}
            </button>
          </div>
          <div className="mc-content">
            <McFilterBar projects={projectList} />
            {activeTab === 'sessions' ? (
              <div className="mission-control-board">
                {SESSION_COLUMNS.map((col) => (
                  <KanbanColumn
                    key={col.id}
                    labelKey={col.labelKey}
                    color={col.color}
                    cards={sessionData.get(col.id as SessionColumnId) ?? []}
                    onClear={col.id === 'done' ? clearDone : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="mission-control-board">
                {PR_COLUMNS.map((col) => (
                  <KanbanColumn
                    key={col.id}
                    labelKey={col.labelKey}
                    color={col.color}
                    cards={prData.get(col.id as PrColumnId) ?? []}
                    emptyKey="emptyColumnPrs"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
