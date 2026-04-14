// ---------------------------------------------------------------------------
// Zustand store — session state shape + action slices
// ---------------------------------------------------------------------------

import { create } from 'zustand'
import { hydratePersistedSessions, bindSessionsStore } from './persistence'
import { createSessionLifecycleActions } from './handlers/sessionLifecycleActions'
import { createCommunicationActions } from './handlers/communicationActions'
import { createModelSettingsActions } from './handlers/modelSettingsActions'
import { createDraftActions } from './handlers/draftActions'
import { createWorktreeLinkActions } from './handlers/worktreeLinkActions'
import { createUserInputActions } from './handlers/userInputActions'
import { createAuthErrorActions } from './handlers/authErrorActions'
import type { SessionsState } from './storeTypes'

export type { SessionsState, QueuedMessage } from './storeTypes'

export const useSessionsStore = create<SessionsState>((set, get, api) => ({
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  sessions: {},
  activeSessionId: null,
  sessionsLoaded: false,
  queuedMessages: {},
  editingQueueSessions: {},
  draftInputs: {},
  draftSnippets: {},
  draftDiffComments: {},
  streamingTextBuffers: {},

  // ---------------------------------------------------------------------------
  // Action slices
  // ---------------------------------------------------------------------------
  ...createSessionLifecycleActions(set, get, api),
  ...createCommunicationActions(set, get, api),
  ...createModelSettingsActions(set, get, api),
  ...createDraftActions(set, get, api),
  ...createWorktreeLinkActions(set, get, api),
  ...createUserInputActions(set, get, api),
  ...createAuthErrorActions(set, get, api),

  // ---------------------------------------------------------------------------
  // Persistence — depends on hydratePersistedSessions directly, stays here
  // ---------------------------------------------------------------------------
  loadPersistedSessions: async () => {
    try {
      const result = await hydratePersistedSessions()
      if (Object.keys(result.sessions).length === 0) {
        set({ sessionsLoaded: true })
        return
      }
      set((s) => ({
        sessions: { ...s.sessions, ...result.sessions },
        sessionsLoaded: true,
        activeSessionId: s.activeSessionId ?? result.activeSessionId
      }))
    } catch (e) {
      console.error('[Braid] Failed to load persisted sessions:', e)
      set({ sessionsLoaded: true })
    }
  }
}))

// Wire up the lazy session getter in persistence.ts to break the circular
// import chain: store.ts → action factories → persistence.ts → store.ts
bindSessionsStore((sessionId) => useSessionsStore.getState().sessions[sessionId])
