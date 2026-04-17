// ---------------------------------------------------------------------------
// Model and settings actions - updateModel, updateThinking, updateExtendedContext,
// updateEffortLevel, updatePlanMode, renameSession, reorderSessions, setConnectedDevice
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/store/ui'
import { supportsExtendedContext, getEffortLevelsForModel, DEFAULT_EFFORT } from '@/lib/constants'
import { persistSession } from '../persistence'
import { sessionOrderPerWorktree, saveMapToStorage, SESSION_ORDER_KEY } from '../storage'
import type { SessionsState } from '../storeTypes'

export const createModelSettingsActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState,
    | 'updateModel'
    | 'updateThinking'
    | 'updateExtendedContext'
    | 'updateEffortLevel'
    | 'updatePlanMode'
    | 'renameSession'
    | 'reorderSessions'
    | 'setConnectedDevice'
  >
> = (set, get) => ({
  updateModel: (sessionId, model) => {
    if (!get().sessions[sessionId]) return
    set((s) => {
      const fresh = s.sessions[sessionId]
      if (!fresh) return s
      // Auto-disable extended context when switching to a model that doesn't support it
      const disableExtended = fresh.extendedContext && !supportsExtendedContext(model)
      // Auto-reset effort level when switching to a model that doesn't support the current level
      const supported = getEffortLevelsForModel(model)
      const resetEffort = supported.length > 0 && !supported.includes(fresh.effortLevel) ? DEFAULT_EFFORT : fresh.effortLevel
      return { sessions: { ...s.sessions, [sessionId]: { ...fresh, model, ...(disableExtended ? { extendedContext: false } : {}), effortLevel: resetEffort } } }
    })
    persistSession(sessionId)
    console.log(`[Braid] model changed -> ${model}`)
  },

  updateThinking: (sessionId, enabled) => {
    if (!get().sessions[sessionId]) return
    set((s) => {
      const fresh = s.sessions[sessionId]
      if (!fresh) return s
      return { sessions: { ...s.sessions, [sessionId]: { ...fresh, thinkingEnabled: enabled } } }
    })
    persistSession(sessionId)
    useUIStore.getState().setDefaultThinking(enabled)
    console.log(`[Braid] thinking -> ${enabled}`)
  },

  updateExtendedContext: (sessionId, enabled) => {
    if (!get().sessions[sessionId]) return
    set((s) => {
      const fresh = s.sessions[sessionId]
      if (!fresh) return s
      return { sessions: { ...s.sessions, [sessionId]: { ...fresh, extendedContext: enabled } } }
    })
    persistSession(sessionId)
    useUIStore.getState().setDefaultExtendedContext(enabled)
    console.log(`[Braid] extendedContext -> ${enabled}`)
  },

  updateEffortLevel: (sessionId, level) => {
    if (!get().sessions[sessionId]) return
    set((s) => {
      const fresh = s.sessions[sessionId]
      if (!fresh) return s
      return { sessions: { ...s.sessions, [sessionId]: { ...fresh, effortLevel: level } } }
    })
    persistSession(sessionId)
    useUIStore.getState().setDefaultEffortLevel(level)
    console.log(`[Braid] effortLevel -> ${level}`)
  },

  updatePlanMode: (sessionId, enabled) => {
    if (!get().sessions[sessionId]) return
    set((s) => {
      const fresh = s.sessions[sessionId]
      if (!fresh) return s
      return { sessions: { ...s.sessions, [sessionId]: { ...fresh, planModeEnabled: enabled } } }
    })
    persistSession(sessionId)
    console.log(`[Braid] planMode -> ${enabled}`)
  },

  renameSession: (sessionId, name) => {
    if (!get().sessions[sessionId]) return
    const trimmed = name.trim()
    set((s) => {
      const fresh = s.sessions[sessionId]
      if (!fresh) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...fresh, name: trimmed || 'New Chat', customName: trimmed.length > 0 }
        }
      }
    })
    persistSession(sessionId)
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
