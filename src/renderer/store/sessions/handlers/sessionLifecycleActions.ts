// ---------------------------------------------------------------------------
// Session lifecycle actions — createSession, setActiveSession, stopSession,
// closeSession, closeSessionsByWorktree
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import type { AgentSession } from '@/types'
import * as ipc from '@/lib/ipc'
import { useUIStore, selectActiveCenterView } from '@/store/ui'
import { stopPeriodicFlush, flushStreamingBuffer } from '../streaming'
import { persistSession } from '../persistence'
import {
  sessionWorktreePaths,
  sessionLinkedPaths,
  lastActivePerWorktree,
  sessionOrderPerWorktree,
  saveMapToStorage,
  LAST_ACTIVE_KEY,
  SESSION_ORDER_KEY
} from '../storage'
import type { SessionsState } from '../storeTypes'
import { pickNextActiveSessionId, buildBulkDeletedState } from './sessionLifecycleHelpers'

// Re-export pure helpers so consumers only need one import
export { pickNextActiveSessionId, buildBulkDeletedState } from './sessionLifecycleHelpers'

export const createSessionLifecycleActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState,
    | 'createSession'
    | 'setActiveSession'
    | 'stopSession'
    | 'closeSession'
    | 'closeSessionsByWorktree'
  >
> = (set, get) => ({
  createSession: (worktreeId, worktreePath) => {
    const id = `session-${Date.now()}`
    const session: AgentSession = {
      id,
      worktreeId,
      name: 'New Chat',
      customName: false,
      status: 'inactive',
      model: useUIStore.getState().defaultModel,
      thinkingEnabled: useUIStore.getState().defaultThinking,
      planModeEnabled: false,
      messages: [],
      activity: null,
      runStartedAt: null,
      runCompletedAt: null,
      totalRunDurationMs: 0,
      tokenUsage: null,
      contextTokens: null,
      createdAt: Date.now()
    }
    set((s) => ({
      sessions: { ...s.sessions, [id]: session },
      activeSessionId: id
    }))
    sessionWorktreePaths.set(id, worktreePath)
    persistSession(id)
    return id
  },

  setActiveSession: (sessionId) => {
    if (sessionId) {
      const session = get().sessions[sessionId]
      if (session) {
        lastActivePerWorktree.set(session.worktreeId, sessionId)
        saveMapToStorage(LAST_ACTIVE_KEY, lastActivePerWorktree)
      }
    }
    set({ activeSessionId: sessionId })
  },

  stopSession: (sessionId) => {
    ipc.agent.stopSession(sessionId)
    stopPeriodicFlush(sessionId)
    flushStreamingBuffer(sessionId)
    const session = get().sessions[sessionId]
    if (session) {
      const messages = session.messages.map((m) =>
        m.isPartial ? { ...m, isPartial: false } : m
      )
      set((s) => {
        const current = s.sessions[sessionId]
        if (!current) return s
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...current,
              status: 'idle',
              activity: null,
              messages,
              runCompletedAt: null,
              pendingQuestion: undefined,
              pendingPlanApproval: undefined,
              pendingToolPermission: undefined,
              pendingAuthError: undefined
            }
          }
        }
      })
    }
  },

  closeSession: (sessionId) => {
    stopPeriodicFlush(sessionId)
    ipc.agent.closeSession(sessionId)
    ipc.sessions.delete(sessionId).catch(() => {})
    sessionWorktreePaths.delete(sessionId)
    sessionLinkedPaths.delete(sessionId)

    const closedSession = get().sessions[sessionId]
    const { [sessionId]: _, ...restSessions } = get().sessions
    let activeSessionId = get().activeSessionId

    if (activeSessionId === sessionId) {
      const order = closedSession ? sessionOrderPerWorktree.get(closedSession.worktreeId) : undefined
      activeSessionId = pickNextActiveSessionId(restSessions, sessionId, order)

      if (order) {
        const updated = order.filter((id) => id !== sessionId)
        if (updated.length > 0) {
          sessionOrderPerWorktree.set(closedSession!.worktreeId, updated)
        } else {
          sessionOrderPerWorktree.delete(closedSession!.worktreeId)
        }
        saveMapToStorage(SESSION_ORDER_KEY, sessionOrderPerWorktree)
      }
    }

    // Clear activeCenterView if it pointed to the closed session
    const acv = selectActiveCenterView(useUIStore.getState())
    if (acv?.type === 'session' && acv.sessionId === sessionId) {
      useUIStore.getState().setActiveCenterView(
        activeSessionId ? { type: 'session', sessionId: activeSessionId } : null
      )
    }

    const { [sessionId]: _q, ...restQueued } = get().queuedMessages
    const { [sessionId]: _eq, ...restEditing } = get().editingQueueSessions
    const { [sessionId]: _d, ...restDrafts } = get().draftInputs
    const { [sessionId]: _sn, ...restSnippets } = get().draftSnippets
    const { [sessionId]: _b, ...restBuffers } = get().streamingTextBuffers
    set({
      sessions: restSessions,
      activeSessionId,
      queuedMessages: restQueued,
      editingQueueSessions: restEditing,
      draftInputs: restDrafts,
      draftSnippets: restSnippets,
      streamingTextBuffers: restBuffers
    })
  },

  closeSessionsByWorktree: (worktreeId) => {
    const toDelete = Object.values(get().sessions).filter((s) => s.worktreeId === worktreeId)
    if (toDelete.length === 0) {
      ipc.sessions.deleteByWorktree(worktreeId).catch(() => {})
      return
    }

    for (const s of toDelete) {
      stopPeriodicFlush(s.id)
      ipc.agent.closeSession(s.id)
      sessionWorktreePaths.delete(s.id)
      sessionLinkedPaths.delete(s.id)
    }

    ipc.sessions.deleteByWorktree(worktreeId).catch(() => {})

    const deleteIds = new Set(toDelete.map((s) => s.id))
    const filtered = buildBulkDeletedState(get(), deleteIds)

    const currentActive = get().activeSessionId
    const activeSessionId =
      currentActive && deleteIds.has(currentActive)
        ? (Object.keys(filtered.sessions)[0] ?? null)
        : currentActive

    sessionOrderPerWorktree.delete(worktreeId)
    saveMapToStorage(SESSION_ORDER_KEY, sessionOrderPerWorktree)
    lastActivePerWorktree.delete(worktreeId)
    saveMapToStorage(LAST_ACTIVE_KEY, lastActivePerWorktree)

    set({ ...filtered, activeSessionId })
  }
})
