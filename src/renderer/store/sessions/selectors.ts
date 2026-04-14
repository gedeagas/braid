// ---------------------------------------------------------------------------
// Derived state hooks for session data
// ---------------------------------------------------------------------------

import { useShallow } from 'zustand/shallow'
import type { AgentSession, LinkedWorktree } from '@/types'
import { useSessionsStore } from './store'
import { sessionOrderPerWorktree, lastActivePerWorktree } from './storage'

const EMPTY: AgentSession[] = []
const EMPTY_LINKED: LinkedWorktree[] = []

/** Returns sessions for a worktree, respecting explicit drag-reorder */
export function useSessionsForWorktree(worktreeId: string | null): AgentSession[] {
  return useSessionsStore(
    useShallow((s) => {
      if (!worktreeId) return EMPTY
      const all = Object.values(s.sessions).filter((sess) => sess.worktreeId === worktreeId)
      if (all.length === 0) return EMPTY

      // Apply explicit ordering if available
      const order = sessionOrderPerWorktree.get(worktreeId)
      if (order) {
        const ordered: AgentSession[] = []
        const remaining = new Map(all.map((sess) => [sess.id, sess]))
        for (const id of order) {
          const sess = remaining.get(id)
          if (sess) {
            ordered.push(sess)
            remaining.delete(id)
          }
        }
        // Append any sessions not in the explicit order
        for (const sess of remaining.values()) {
          ordered.push(sess)
        }
        // Keep the order map in sync
        sessionOrderPerWorktree.set(worktreeId, ordered.map((sess) => sess.id))
        return ordered
      }

      // No explicit order yet — initialize it
      sessionOrderPerWorktree.set(worktreeId, all.map((sess) => sess.id))
      return all
    })
  )
}

/** Returns the currently active session, or null */
export function useActiveSession(): AgentSession | null {
  return useSessionsStore(
    useShallow((s) => (s.activeSessionId ? s.sessions[s.activeSessionId] ?? null : null))
  )
}

/** Returns linked worktrees for a session */
export function useLinkedWorktrees(sessionId: string | null): LinkedWorktree[] {
  return useSessionsStore(
    useShallow((s) => {
      if (!sessionId) return EMPTY_LINKED
      return s.sessions[sessionId]?.linkedWorktrees ?? EMPTY_LINKED
    })
  )
}

/** Returns the last active session ID for a worktree (non-reactive, direct map read) */
export function getLastActiveForWorktree(worktreeId: string): string | undefined {
  return lastActivePerWorktree.get(worktreeId)
}
