// ---------------------------------------------------------------------------
// Model and settings actions — updateModel, updateThinking, updatePlanMode,
// renameSession, reorderSessions, setConnectedDevice
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/store/ui'
import { persistSession } from '../persistence'
import { sessionOrderPerWorktree, saveMapToStorage, SESSION_ORDER_KEY } from '../storage'
import type { SessionsState } from '../storeTypes'

export const createModelSettingsActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState,
    | 'updateModel'
    | 'updateBackend'
    | 'updateThinking'
    | 'updatePlanMode'
    | 'renameSession'
    | 'reorderSessions'
    | 'setConnectedDevice'
  >
> = (set, get) => ({
  updateModel: (sessionId, model) => {
    const session = get().sessions[sessionId]
    if (session) {
      set((s) => ({
        sessions: { ...s.sessions, [sessionId]: { ...session, model } }
      }))
      persistSession(sessionId)
      console.log(`[Braid] model changed → ${model} | thinking: ${session.thinkingEnabled} | planMode: ${session.planModeEnabled}`)
    }
  },

  updateBackend: (sessionId, backend) => {
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session) return s
      return { sessions: { ...s.sessions, [sessionId]: { ...session, backend } } }
    })
    persistSession(sessionId)
    console.log(`[Braid] backend changed → ${backend?.type ?? 'claude-sdk'}`)
  },

  updateThinking: (sessionId, enabled) => {
    const session = get().sessions[sessionId]
    if (session) {
      set((s) => ({
        sessions: { ...s.sessions, [sessionId]: { ...session, thinkingEnabled: enabled } }
      }))
      persistSession(sessionId)
      // Persist as default for new sessions
      useUIStore.getState().setDefaultThinking(enabled)
      console.log(`[Braid] thinking → ${enabled} | model: ${session.model} | planMode: ${session.planModeEnabled}`)
    }
  },

  updatePlanMode: (sessionId, enabled) => {
    const session = get().sessions[sessionId]
    if (session) {
      set((s) => ({
        sessions: { ...s.sessions, [sessionId]: { ...session, planModeEnabled: enabled } }
      }))
      persistSession(sessionId)
      console.log(`[Braid] planMode → ${enabled} | model: ${session.model} | thinking: ${session.thinkingEnabled}`)
    }
  },

  renameSession: (sessionId, name) => {
    const session = get().sessions[sessionId]
    if (!session) return
    const trimmed = name.trim()
    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: {
          ...session,
          name: trimmed || 'New Chat',
          customName: trimmed.length > 0
        }
      }
    }))
    persistSession(sessionId)
    // Sync to main process so notifications use the updated name
    ipc.agent.updateSessionName(sessionId, trimmed || 'New Chat')
  },

  reorderSessions: (worktreeId, fromIndex, toIndex) => {
    const ids = sessionOrderPerWorktree.get(worktreeId)
    if (!ids) return
    const next = [...ids]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    sessionOrderPerWorktree.set(worktreeId, next)
    saveMapToStorage(SESSION_ORDER_KEY, sessionOrderPerWorktree)
    set({})
  },

  setConnectedDevice: (sessionId, deviceId) => {
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session) return s
      return { sessions: { ...s.sessions, [sessionId]: { ...session, connectedDeviceId: deviceId } } }
    })
  }
})
