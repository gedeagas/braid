// ---------------------------------------------------------------------------
// Network error actions - retryAfterNetworkError, dismissNetworkError
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import { updateSession } from '../stateUtils'
import { useSessionsStore } from '../store'
import type { SessionsState } from '../storeTypes'

export const createNetworkErrorActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState, 'retryAfterNetworkError' | 'dismissNetworkError'>
> = (_set, get) => ({
  retryAfterNetworkError: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session?.pendingNetworkError) return

    // Find the last user message to retry
    const lastUserMsg = [...session.messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg) return

    // Clear the network error state
    updateSession(useSessionsStore, sessionId, () => ({
      pendingNetworkError: undefined,
      status: 'idle' as const
    }))

    // Re-send the last user message
    get().sendMessage(sessionId, lastUserMsg.content, lastUserMsg.images)
  },

  dismissNetworkError: (sessionId) => {
    updateSession(useSessionsStore, sessionId, () => ({
      status: 'idle' as const,
      activity: null,
      pendingNetworkError: undefined
    }))
  }
})
