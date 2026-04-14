// ---------------------------------------------------------------------------
// User input actions — answerQuestion, approvePlan, rejectPlan,
// allowTool, denyTool, alwaysAllowTool, answerElicitation
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import type { AgentSession } from '@/types'
import * as ipc from '@/lib/ipc'
import { useToastsStore } from '@/store/toasts'
import { thinkingActivity } from '../activity'
import type { SessionsState } from '../storeTypes'

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

/**
 * Builds the common "resume running" session patch shared by all user-input
 * response actions. Clears all pending states, restores running status.
 *
 * Note: `overrides` is applied after the base patch, so callers CAN override
 * any field including pending ones — this is intentional for approvePlan /
 * rejectPlan which need to set `planModeEnabled`.
 */
export function buildResumedSessionState(
  session: AgentSession,
  overrides?: Partial<AgentSession>
): Partial<AgentSession> {
  return {
    status: 'running',
    activity: thinkingActivity(),
    runStartedAt: Date.now(),
    runCompletedAt: null,
    pendingQuestion: undefined,
    pendingPlanApproval: undefined,
    pendingToolPermission: undefined,
    pendingAuthError: undefined,
    pendingElicitation: undefined,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createUserInputActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState,
    | 'answerQuestion'
    | 'approvePlan'
    | 'rejectPlan'
    | 'allowTool'
    | 'denyTool'
    | 'alwaysAllowTool'
    | 'answerElicitation'
  >
> = (set, get) => ({
  answerQuestion: (sessionId, answers) => {
    const session = get().sessions[sessionId]
    if (!session?.pendingQuestion) return
    // Capture IPC payload from pending state before set() clears it
    const questions = session.pendingQuestion.questions
    ipc.agent.answerToolInput(sessionId, {
      behavior: 'allow',
      updatedInput: { questions, answers }
    })
    set((s) => {
      const current = s.sessions[sessionId]
      if (!current) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...current, ...buildResumedSessionState(current) }
        }
      }
    })
    useToastsStore.getState().dismissBySession(sessionId)
  },

  approvePlan: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session?.pendingPlanApproval) return
    ipc.agent.answerToolInput(sessionId, { behavior: 'allow', updatedInput: {} })
    set((s) => {
      const current = s.sessions[sessionId]
      if (!current) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...current,
            ...buildResumedSessionState(current, { planModeEnabled: false })
          }
        }
      }
    })
    useToastsStore.getState().dismissBySession(sessionId)
  },

  rejectPlan: (sessionId, reason?) => {
    const session = get().sessions[sessionId]
    if (!session?.pendingPlanApproval) return
    ipc.agent.answerToolInput(sessionId, {
      behavior: 'deny',
      message: reason || 'User rejected the plan. Please revise.'
    })
    set((s) => {
      const current = s.sessions[sessionId]
      if (!current) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...current,
            ...buildResumedSessionState(current, { planModeEnabled: true })
          }
        }
      }
    })
    useToastsStore.getState().dismissBySession(sessionId)
  },

  allowTool: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session?.pendingToolPermission) return
    // Capture toolInput before set() clears pendingToolPermission
    const toolInput = session.pendingToolPermission.toolInput
    ipc.agent.answerToolInput(sessionId, { behavior: 'allow', updatedInput: toolInput })
    set((s) => {
      const current = s.sessions[sessionId]
      if (!current) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...current, ...buildResumedSessionState(current) }
        }
      }
    })
    useToastsStore.getState().dismissBySession(sessionId)
  },

  denyTool: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session?.pendingToolPermission) return
    ipc.agent.answerToolInput(sessionId, { behavior: 'deny', message: 'Denied by user' })
    set((s) => {
      const current = s.sessions[sessionId]
      if (!current) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...current, ...buildResumedSessionState(current) }
        }
      }
    })
    useToastsStore.getState().dismissBySession(sessionId)
  },

  alwaysAllowTool: (sessionId, rule) => {
    // Persist to global allow list (fire-and-forget), then resume the agent
    ipc.claudeConfig.getPermissions().then((perms) => {
      if (!perms.allow.includes(rule)) {
        ipc.claudeConfig.setPermissions({ ...perms, allow: [...perms.allow, rule] }).catch(() => {})
      }
    }).catch(() => {})
    get().allowTool(sessionId)
  },

  answerElicitation: (sessionId, result) => {
    const session = get().sessions[sessionId]
    if (!session?.pendingElicitation) return
    ipc.agent.answerElicitation(sessionId, result)
    set((s) => {
      const current = s.sessions[sessionId]
      if (!current) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...current, ...buildResumedSessionState(current) }
        }
      }
    })
    useToastsStore.getState().dismissBySession(sessionId)
  }
})
