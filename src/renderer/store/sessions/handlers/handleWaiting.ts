// ---------------------------------------------------------------------------
// Waiting/error handlers — waitingInput, error
// ---------------------------------------------------------------------------

import type { AuthErrorType, Message } from '@/types'
import type { HandlerContext } from './types'
import { updateSession, msgId, resolvePendingState } from '../stateUtils'
import { persistSession } from '../persistence'
import { stopPeriodicFlush, flushStreamingBuffer } from '../streaming'
import { findLastAssistantWithTools } from '../helpers'
import { maybeShowToast, createNotificationDeps } from './notifications'

/**
 * Handle `waiting_input` event: Claude is paused awaiting user action.
 *
 * Three paths:
 * - `reason === 'tool_permission'`: direct tool permission prompt (data in event)
 * - `reason === 'elicitation'`: MCP server auth/input request (data in event)
 * - Otherwise: AskUserQuestion / ExitPlanMode (resolved from message history)
 */
export function handleWaitingInput(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const { store, sessionId } = ctx
  const reason = ev.reason as string | undefined

  if (reason === 'tool_permission') {
    updateSession(store, sessionId, () => ({
      status: 'waiting_input' as const,
      activity: 'Waiting for permission...',
      pendingToolPermission: {
        toolUseId: ev.toolUseId as string,
        toolName: ev.toolName as string,
        toolInput: (ev.toolInput as Record<string, unknown>) ?? {},
        displayName: ev.displayName as string | undefined,
        description: ev.description as string | undefined
      }
    }))
    persistSession(sessionId)
    maybeShowToast(sessionId, 'waiting_input', createNotificationDeps())
    return
  }

  if (reason === 'elicitation') {
    updateSession(store, sessionId, () => ({
      status: 'waiting_input' as const,
      activity: `${ev.serverName as string} needs authentication...`,
      pendingElicitation: {
        serverName: ev.serverName as string,
        message: ev.message as string,
        mode: ev.mode as 'form' | 'url' | undefined,
        url: ev.url as string | undefined,
        elicitationId: ev.elicitationId as string | undefined,
        requestedSchema: ev.requestedSchema as Record<string, unknown> | undefined,
      }
    }))
    persistSession(sessionId)
    maybeShowToast(sessionId, 'waiting_input', createNotificationDeps())
    return
  }

  // AskUserQuestion / ExitPlanMode: resolve pending state from message history
  const session = store.getState().sessions[sessionId]
  if (!session || session.status === 'waiting_input') return

  const lastAssistant = findLastAssistantWithTools(session.messages)
  const pending = lastAssistant?.toolCalls
    ? resolvePendingState(lastAssistant.toolCalls, session.messages)
    : null

  updateSession(store, sessionId, () => ({
    status: 'waiting_input' as const,
    activity: 'Waiting for your input...',
    ...pending
  }))
  persistSession(sessionId)
  maybeShowToast(
    sessionId,
    'waiting_input',
    createNotificationDeps(),
    reason as 'question' | 'plan_approval' | undefined
  )
}

/**
 * Handle `error` event: session failed. Drains the streaming buffer,
 * appends a system error message, and sets status to 'error'.
 *
 * Auth errors (`errorKind === 'auth'`) set `pendingAuthError` instead of
 * appending a raw system message — the UI renders an actionable prompt.
 */
export function handleError(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const { store, sessionId } = ctx

  stopPeriodicFlush(sessionId)
  flushStreamingBuffer(sessionId)

  const basePatch = (current: import('@/types').AgentSession) => ({
    status: 'error' as const,
    activity: null,
    runStartedAt: null,
    totalRunDurationMs:
      (current.totalRunDurationMs ?? 0) +
      (current.runStartedAt ? Date.now() - current.runStartedAt : 0),
    messages: current.messages.map((m) => (m.isPartial ? { ...m, isPartial: false } : m))
  })

  if (ev.errorKind === 'auth') {
    if (!updateSession(store, sessionId, (current) => ({
      ...basePatch(current),
      pendingAuthError: {
        message: String(ev.message),
        authType: (ev.authType as AuthErrorType) ?? 'unknown'
      }
    }))) return
    persistSession(sessionId)
    maybeShowToast(sessionId, 'error', createNotificationDeps())
    return
  }

  const errorMsg: Message = {
    id: msgId(),
    role: 'system',
    content: `Error: ${ev.message}`,
    timestamp: Date.now()
  }

  if (!updateSession(store, sessionId, (current) => ({
    ...basePatch(current),
    messages: [...basePatch(current).messages, errorMsg]
  }))) return

  persistSession(sessionId)
  maybeShowToast(sessionId, 'error', createNotificationDeps())
}
