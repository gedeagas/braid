// ---------------------------------------------------------------------------
// Worktree link actions — linkWorktree, unlinkWorktree
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import { persistSession } from '../persistence'
import { sessionLinkedPaths } from '../storage'
import type { SessionsState } from '../storeTypes'

export const createWorktreeLinkActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState, 'linkWorktree' | 'unlinkWorktree'>
> = (set, get) => ({
  linkWorktree: (sessionId, linked) => {
    const session = get().sessions[sessionId]
    if (!session) return
    // Prevent linking own worktree or duplicate links
    if (linked.worktreeId === session.worktreeId) return
    const existing = session.linkedWorktrees ?? []
    if (existing.some((lw) => lw.worktreeId === linked.worktreeId)) return
    const updated = [...existing, linked]
    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: { ...s.sessions[sessionId], linkedWorktrees: updated }
      }
    }))
    sessionLinkedPaths.set(sessionId, updated.map((lw) => lw.path))
    persistSession(sessionId)
  },

  unlinkWorktree: (sessionId, worktreeId) => {
    const session = get().sessions[sessionId]
    if (!session?.linkedWorktrees) return
    const updated = session.linkedWorktrees.filter((lw) => lw.worktreeId !== worktreeId)
    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: {
          ...s.sessions[sessionId],
          linkedWorktrees: updated.length > 0 ? updated : undefined
        }
      }
    }))
    if (updated.length > 0) {
      sessionLinkedPaths.set(sessionId, updated.map((lw) => lw.path))
    } else {
      sessionLinkedPaths.delete(sessionId)
    }
    persistSession(sessionId)
  }
})
