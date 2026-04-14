// ---------------------------------------------------------------------------
// Communication actions — fetchSlashCommands, sendMessage
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import * as ipc from '@/lib/ipc'
import { useProjectsStore } from '@/store/projects'
import { thinkingActivity } from '../activity'
import { persistSession } from '../persistence'
import { sessionWorktreePaths, sessionLinkedPaths, pendingTitleGenerations } from '../storage'
import type { SessionsState } from '../storeTypes'
import { buildLinkedWorktreeContext } from './communicationHelpers'

// Re-export pure helper so consumers only need one import
export { buildLinkedWorktreeContext } from './communicationHelpers'

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createCommunicationActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState, 'fetchSlashCommands' | 'sendMessage'>
> = (set, get) => ({
  fetchSlashCommands: async (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session) return
    if (session.slashCommands && session.slashCommands.length > 0) return

    const worktreePath = sessionWorktreePaths.get(sessionId) ?? ''
    if (!worktreePath) return

    try {
      const commands = await ipc.agent.getSlashCommands(worktreePath)
      set((s) => {
        const current = s.sessions[sessionId]
        if (!current) return s
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: { ...current, slashCommands: commands }
          }
        }
      })
    } catch (e) {
      console.error('[Braid] Failed to fetch slash commands:', e)
    }
  },

  sendMessage: async (sessionId, text, images?, options?) => {
    const session = get().sessions[sessionId]
    if (!session) return

    const hasText = text && text.trim().length > 0
    const hasImages = images && images.length > 0
    if (!hasText && !hasImages) return

    const userMsg = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: text,
      images: images && images.length > 0 ? images : undefined,
      ...(options?.tag ? { tag: options.tag } : {}),
      timestamp: Date.now()
    }

    set((s) => {
      const current = s.sessions[sessionId]
      if (!current) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...current,
            status: 'running' as const,
            activity: thinkingActivity(),
            runStartedAt: Date.now(),
            runCompletedAt: null,
            pendingQuestion: undefined,
            pendingPlanApproval: undefined,
            pendingToolPermission: undefined,
            pendingAuthError: undefined,
            messages: [...current.messages, userMsg]
          }
        }
      }
    })
    persistSession(sessionId)

    // Eagerly generate title on first message so it's ready before 'done' fires
    if (!session.customName && session.name === 'New Chat' && hasText) {
      const promise = ipc.agent.generateSessionTitle(text.slice(0, 2000), '').catch(() => '')
      pendingTitleGenerations.set(sessionId, promise)
    }

    const worktreePath = sessionWorktreePaths.get(sessionId) ?? ''
    const additionalDirs = sessionLinkedPaths.get(sessionId)
    const freshSession = get().sessions[sessionId]
    const linkedContext = buildLinkedWorktreeContext(freshSession?.linkedWorktrees)

    // Resolve mobileFramework from the project owning this session's worktree
    const projectState = useProjectsStore.getState()
    const project = projectState.projects.find((p) =>
      p.worktrees.some((w) => w.path === worktreePath)
    )
    const fw = project?.mobileFramework
    const mobileFramework = (fw === 'react-native' || fw === 'flutter') ? fw : undefined

    if (freshSession?.sdkSessionId) {
      const worktreeCwd = sessionWorktreePaths.get(sessionId) ?? worktreePath
      await ipc.agent.sendMessage(
        sessionId, text, freshSession.sdkSessionId, worktreeCwd,
        freshSession.model, freshSession.planModeEnabled, freshSession.name,
        images, additionalDirs, linkedContext, freshSession.connectedDeviceId, mobileFramework
      )
    } else if (freshSession) {
      await ipc.agent.startSession(
        sessionId, freshSession.worktreeId, worktreePath, text, freshSession.model,
        freshSession.thinkingEnabled, freshSession.planModeEnabled, freshSession.name,
        images, additionalDirs, linkedContext, freshSession.connectedDeviceId, mobileFramework
      )
    }
  }
})

