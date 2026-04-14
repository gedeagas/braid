// ---------------------------------------------------------------------------
// Pure helpers for session lifecycle — no store dependencies
// ---------------------------------------------------------------------------

import type { AgentSession, SnippetAttachment } from '@/types'
import type { QueuedMessage } from '../storeTypes'

/**
 * Given a worktree's session order list and the id being closed, returns the
 * id of the next session to activate, or null if none remain.
 */
export function pickNextActiveSessionId(
  sessions: Record<string, AgentSession>,
  closedId: string,
  order: string[] | undefined
): string | null {
  if (!order) return null
  const idx = order.indexOf(closedId)
  if (idx === -1) return null
  const candidates = [order[idx + 1], order[idx - 1]]
  for (const id of candidates) {
    if (id && sessions[id] && id !== closedId) return id
  }
  return null
}

/**
 * Filters sessions, queuedMessages, draftInputs, draftSnippets, and
 * streamingTextBuffers to exclude any ids in the delete set.
 */
export function buildBulkDeletedState(
  state: {
    sessions: Record<string, AgentSession>
    queuedMessages: Record<string, QueuedMessage>
    draftInputs: Record<string, string>
    draftSnippets: Record<string, SnippetAttachment[]>
    streamingTextBuffers: Record<string, string>
  },
  deleteIds: Set<string>
): {
  sessions: Record<string, AgentSession>
  queuedMessages: Record<string, QueuedMessage>
  draftInputs: Record<string, string>
  draftSnippets: Record<string, SnippetAttachment[]>
  streamingTextBuffers: Record<string, string>
} {
  const sessions: Record<string, AgentSession> = {}
  const queuedMessages: Record<string, QueuedMessage> = {}
  const draftInputs: Record<string, string> = {}
  const draftSnippets: Record<string, SnippetAttachment[]> = {}
  const streamingTextBuffers: Record<string, string> = {}

  for (const [id, s] of Object.entries(state.sessions)) {
    if (!deleteIds.has(id)) sessions[id] = s
  }
  for (const [id, m] of Object.entries(state.queuedMessages)) {
    if (!deleteIds.has(id)) queuedMessages[id] = m
  }
  for (const [id, t] of Object.entries(state.draftInputs)) {
    if (!deleteIds.has(id)) draftInputs[id] = t
  }
  for (const [id, sn] of Object.entries(state.draftSnippets)) {
    if (!deleteIds.has(id)) draftSnippets[id] = sn
  }
  for (const [id, b] of Object.entries(state.streamingTextBuffers)) {
    if (!deleteIds.has(id)) streamingTextBuffers[id] = b
  }

  return { sessions, queuedMessages, draftInputs, draftSnippets, streamingTextBuffers }
}
