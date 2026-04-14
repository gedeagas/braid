import { useShallow } from 'zustand/shallow'
import { useSessionsStore } from '@/store/sessions'
import type { Worktree } from '@/types'

export type ProjectNotifyStatus = 'waiting_input' | 'error' | null

/**
 * Returns the highest-priority notification status across all worktrees in a project.
 *
 * Priority: waiting_input > error > null
 *
 * Uses useShallow so only real status transitions (not streaming updates) cause re-renders.
 */
export function useProjectNotifyStatus(worktrees: Worktree[]): ProjectNotifyStatus {
  const worktreeIds = worktrees.map((w) => w.id)

  return useSessionsStore(
    useShallow((s) => {
      let hasError = false
      for (const session of Object.values(s.sessions)) {
        if (!worktreeIds.includes(session.worktreeId)) continue
        if (session.status === 'waiting_input') return 'waiting_input' // highest priority
        if (session.status === 'error') hasError = true
      }
      return hasError ? 'error' : null
    })
  )
}
