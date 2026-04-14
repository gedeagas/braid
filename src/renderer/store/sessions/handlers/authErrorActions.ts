// ---------------------------------------------------------------------------
// Auth error actions — retryAfterAuth, dismissAuthError
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import { updateSession } from '../stateUtils'
import { useSessionsStore } from '../store'
import type { SessionsState } from '../storeTypes'

export const createAuthErrorActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState, 'retryAfterAuth' | 'dismissAuthError'>
> = (_set, get) => ({
  retryAfterAuth: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session?.pendingAuthError) return

    // Find the last user message to retry
    const lastUserMsg = [...session.messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg) return

    // Clear the auth error state
    updateSession(useSessionsStore, sessionId, () => ({
      pendingAuthError: undefined,
      status: 'idle' as const
    }))

    // Re-send the last user message
    get().sendMessage(sessionId, lastUserMsg.content, lastUserMsg.images)
  },

  dismissAuthError: (sessionId) => {
    updateSession(useSessionsStore, sessionId, () => ({
      status: 'idle' as const,
      activity: null,
      pendingAuthError: undefined
    }))
  }
})
