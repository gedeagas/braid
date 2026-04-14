import { create } from 'zustand'
import * as ipc from '@/lib/ipc'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitStats {
  additions: number
  deletions: number
  total: number
}

type ChecksSummary = 'passing' | 'failing' | 'pending' | 'none'

interface MissionControlState {
  /** Git file change counts per worktree path */
  gitStats: Record<string, GitStats>
  /** CI checks summary per worktree path */
  checksStatus: Record<string, ChecksSummary>
  /** Whether a full refresh is in progress */
  refreshing: boolean
  /** Session IDs manually dismissed from Need Attention → Done, mapped to dismiss timestamp */
  dismissedSessionIds: Map<string, number>
  /** Timestamp of the last "Clear Done" action — sessions completed before this move to Idle */
  doneLastClearedAt: number | null

  /** Text search filter (empty = no filter) */
  filterQuery: string
  /** Selected project IDs for filtering (empty = all projects) */
  filterProjectIds: Set<string>

  refreshAll: (worktreePaths: string[]) => Promise<void>
  refreshGitStats: (worktreePath: string) => Promise<void>
  refreshChecks: (worktreePath: string) => Promise<void>
  dismissSession: (sessionId: string) => void
  undismissSession: (sessionId: string) => void
  clearDone: () => void
  setFilterQuery: (query: string) => void
  toggleFilterProject: (projectId: string) => void
  clearFilters: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run promises with a concurrency limit */
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<void> {
  const executing = new Set<Promise<void>>()
  for (const task of tasks) {
    const p = task().then(() => { executing.delete(p) }).catch(() => { executing.delete(p) })
    executing.add(p)
    if (executing.size >= limit) await Promise.race(executing)
  }
  await Promise.allSettled(executing)
}

function deriveChecksSummary(
  checks: Array<{ status: string; conclusion: string | null }>
): ChecksSummary {
  if (checks.length === 0) return 'none'
  if (checks.some((c) => c.status === 'in_progress' || c.status === 'queued')) return 'pending'
  if (checks.some((c) => c.conclusion === 'failure' || c.conclusion === 'cancelled')) return 'failing'
  if (checks.every((c) => c.conclusion === 'success' || c.conclusion === 'skipped')) return 'passing'
  return 'pending'
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useMissionControlStore = create<MissionControlState>((set, get) => ({
  gitStats: {},
  checksStatus: {},
  refreshing: false,
  dismissedSessionIds: new Map<string, number>(),
  doneLastClearedAt: null,
  filterQuery: '',
  filterProjectIds: new Set<string>(),

  refreshAll: async (worktreePaths) => {
    if (get().refreshing) return
    set({ refreshing: true })

    const tasks = worktreePaths.flatMap((path) => [
      () => get().refreshGitStats(path),
      () => get().refreshChecks(path),
    ])

    await withConcurrency(tasks, 5)
    set({ refreshing: false })
  },

  refreshGitStats: async (worktreePath) => {
    try {
      const changes = await ipc.git.getStatus(worktreePath) as Array<{ status: string }>
      const additions = changes.filter((c) => c.status === 'A' || c.status === '?').length
      const deletions = changes.filter((c) => c.status === 'D').length
      const modified = changes.filter((c) => c.status === 'M' || c.status === 'R').length
      const total = changes.length
      set((s) => ({
        gitStats: { ...s.gitStats, [worktreePath]: { additions: additions + modified, deletions, total } }
      }))
    } catch {
      // Silently skip — card renders without stats
    }
  },

  refreshChecks: async (worktreePath) => {
    try {
      const checks = await ipc.github.getChecks(worktreePath) as Array<{ status: string; conclusion: string | null }>
      const summary = deriveChecksSummary(checks)
      set((s) => ({
        checksStatus: { ...s.checksStatus, [worktreePath]: summary }
      }))
    } catch {
      // Silently skip — card renders without checks
    }
  },

  dismissSession: (sessionId) => {
    set((s) => {
      const next = new Map(s.dismissedSessionIds)
      next.set(sessionId, Date.now())
      return { dismissedSessionIds: next }
    })
  },

  undismissSession: (sessionId) => {
    set((s) => {
      const next = new Map(s.dismissedSessionIds)
      next.delete(sessionId)
      return { dismissedSessionIds: next }
    })
  },

  clearDone: () => {
    set({ doneLastClearedAt: Date.now() })
  },

  setFilterQuery: (query) => {
    set({ filterQuery: query })
  },

  toggleFilterProject: (projectId) => {
    set((s) => {
      const next = new Set(s.filterProjectIds)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return { filterProjectIds: next }
    })
  },

  clearFilters: () => {
    set({ filterQuery: '', filterProjectIds: new Set<string>() })
  },
}))
