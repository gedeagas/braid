// ---------------------------------------------------------------------------
// State update utilities — atomic helpers that fix stale-capture bugs
// ---------------------------------------------------------------------------

import type { AgentSession, Message, PendingPlanApproval, PendingQuestion, PendingToolPermission, ToolCall } from '@/types'
import { useSessionsStore } from './store'
import { findPlanFilePath } from './helpers'

export type Store = typeof useSessionsStore

// ---------------------------------------------------------------------------
// updateSession — atomic session patch (reads fresh state inside setState)
// ---------------------------------------------------------------------------

/**
 * Atomically update a session. The updater receives the **current** session
 * from inside setState, preventing stale-capture bugs.
 *
 * Returns false if the session doesn't exist (caller can bail early).
 */
export function updateSession(
  store: Store,
  sessionId: string,
  updater: (current: AgentSession) => Partial<AgentSession>
): boolean {
  if (!store.getState().sessions[sessionId]) return false
  store.setState((s) => {
    const current = s.sessions[sessionId]
    if (!current) return s
    return { sessions: { ...s.sessions, [sessionId]: { ...current, ...updater(current) } } }
  })
  return true
}

// ---------------------------------------------------------------------------
// msgId — unique message ID generation
// ---------------------------------------------------------------------------

let counter = 0

export function msgId(suffix?: string): string {
  return `msg-${Date.now()}-${(++counter).toString(36)}${suffix ? `-${suffix}` : ''}`
}

// ---------------------------------------------------------------------------
// resolvePendingState — detect AskUserQuestion / ExitPlanMode tool calls
// ---------------------------------------------------------------------------

export interface PendingState {
  status: 'waiting_input'
  activity: string
  pendingQuestion?: PendingQuestion
  pendingPlanApproval?: PendingPlanApproval
  pendingToolPermission?: PendingToolPermission
}

export function resolvePendingState(
  toolCalls: ToolCall[],
  messages: Message[]
): PendingState | null {
  const askTc = toolCalls.find((tc) => tc.name === 'AskUserQuestion')
  if (askTc) {
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(askTc.input) } catch { /* ignore */ }
    return {
      status: 'waiting_input',
      activity: 'Waiting for your input...',
      pendingQuestion: {
        toolUseId: askTc.id,
        questions: (parsed.questions as PendingQuestion['questions']) ?? []
      }
    }
  }

  const planTc = toolCalls.find((tc) => tc.name === 'ExitPlanMode')
  if (planTc) {
    return {
      status: 'waiting_input',
      activity: 'Plan ready — awaiting your approval',
      pendingPlanApproval: {
        toolUseId: planTc.id,
        planFilePath: findPlanFilePath(messages)
      }
    }
  }

  return null
}
