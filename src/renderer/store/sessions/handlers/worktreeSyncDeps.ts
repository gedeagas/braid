import type { WorktreeSyncDeps } from './types'
import { sessionWorktreePaths } from '../storage'
import { jira } from '@/lib/ipc'
import { useProjectsStore } from '@/store/projects'

/**
 * Creates the real WorktreeSyncDeps wired to live stores.
 * Use this in production; pass mock objects in tests.
 */
export function createWorktreeSyncDeps(): WorktreeSyncDeps {
  return {
    getWorktreePath: (sessionId) => sessionWorktreePaths.get(sessionId),
    findProjectByWorktreePath: (wtPath) => {
      const project = useProjectsStore.getState().projects.find((p) =>
        p.worktrees.some((w) => w.path === wtPath)
      )
      return project ? { id: project.id } : undefined
    },
    refreshWorktrees: (projectId) =>
      useProjectsStore.getState().refreshWorktrees(projectId),
    invalidateJiraCache: () => jira.invalidateCache(),
  }
}
