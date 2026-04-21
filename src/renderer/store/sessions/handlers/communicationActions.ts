// ---------------------------------------------------------------------------
// Communication actions — fetchSlashCommands, sendMessage
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import * as ipc from '@/lib/ipc'
import { useProjectsStore } from '@/store/projects'
import { useUIStore } from '@/store/ui'
import { thinkingActivity } from '../activity'
import { useSessionsStore } from '../store'
import { persistSession } from '../persistence'
import { updateSession } from '../stateUtils'
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

    // Experimental: take a git snapshot before dispatching the user turn so the
    // user can rollback to this exact moment later. Best-effort — if it fails,
    // the message still goes through (just without a rollback anchor).
    const worktreePathForSnapshot = sessionWorktreePaths.get(sessionId) ?? ''
    const rollbackEnabled = useUIStore.getState().rollbackHistory
    let snapshotSha: string | undefined
    if (rollbackEnabled && worktreePathForSnapshot) {
      try {
        snapshotSha = await ipc.git.createSnapshot(worktreePathForSnapshot)
      } catch (err) {
        console.warn('[Braid] Failed to create rollback snapshot:', err)
      }
    }

    const userMsg = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: text,
      images: images && images.length > 0 ? images : undefined,
      ...(options?.tag ? { tag: options.tag } : {}),
      ...(snapshotSha ? { snapshotSha } : {}),
      timestamp: Date.now()
    }

    // Consume any pendingResumeAt set by a prior rollback - it applies to THIS send.
    const resumeSessionAt = session.pendingResumeAt

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
        freshSession.model, freshSession.extendedContext, freshSession.effortLevel, freshSession.planModeEnabled, freshSession.name,
        images, additionalDirs, linkedContext, freshSession.connectedDeviceId, mobileFramework, resumeSessionAt
      )
    } else if (freshSession) {
      await ipc.agent.startSession(
        sessionId, freshSession.worktreeId, worktreePath, text, freshSession.model,
        freshSession.thinkingEnabled, freshSession.extendedContext, freshSession.effortLevel, freshSession.planModeEnabled, freshSession.name,
        images, additionalDirs, linkedContext, freshSession.connectedDeviceId, mobileFramework
      )
    }

    // Clear pendingResumeAt only after the IPC call succeeds. If the send
    // failed, the value is preserved so a retry can use it.
    if (resumeSessionAt) {
      updateSession(useSessionsStore, sessionId, () => ({ pendingResumeAt: undefined }))
    }
  }
})

