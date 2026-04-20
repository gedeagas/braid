// ---------------------------------------------------------------------------
// Message handlers — user (tool results), assistant (complete turn)
// ---------------------------------------------------------------------------

import type { ContentBlock, ToolCall } from '@/types'
import type { HandlerContext } from './types'
import { extractToolResultPatches } from './toolResultParser'
import { triggerWorktreeRefreshIfNeeded, createWorktreeSyncDeps } from './worktreeSync'
import { updateSession, msgId, resolvePendingState } from '../stateUtils'
import { persistSession } from '../persistence'
import { stopPeriodicFlush, flushStreamingBuffer } from '../streaming'
import { findLastAssistantWithTools, extractContentBlocks } from '../helpers'

/**
 * Handle `user` event: attach tool execution results to the preceding
 * assistant message's tool calls, matched by toolUseId.
 */
export function handleUser(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const { store, sessionId } = ctx

  const msg = ev.message as Record<string, unknown> | undefined
  if (!msg || !Array.isArray(msg.content)) return

  const patches = extractToolResultPatches(msg.content as Array<Record<string, unknown>>)
  if (patches.length === 0) return

  // Side effect: refresh worktree after git push / gh pr create.
  // Uses stable tool call IDs from a snapshot — safe to read before setState.
  const snapshot = store.getState().sessions[sessionId]
  if (snapshot) {
    const lastAssistant = findLastAssistantWithTools(snapshot.messages)
    if (lastAssistant?.toolCalls) {
      triggerWorktreeRefreshIfNeeded(sessionId, patches, lastAssistant.toolCalls, createWorktreeSyncDeps())
    }
  }

  // Atomic state update — reads fresh messages inside setState
  updateSession(store, sessionId, (current) => {
    const lastAssistant = findLastAssistantWithTools(current.messages)
    if (!lastAssistant) return {}

    const completedAt = Date.now()
    const messages = current.messages.map((m) => {
      if (m !== lastAssistant) return m

      const updatedToolCalls = m.toolCalls?.map((tc) => {
        const patch = patches.find((p) => p.toolUseId === tc.id)
        return patch ? { ...tc, result: patch.result, error: patch.error, completedAt } : tc
      })
      const updatedBlocks = m.blocks?.map((bl) => {
        if (bl.type !== 'tool_use') return bl
        const patch = patches.find((p) => p.toolUseId === bl.toolCall.id)
        return patch
          ? { ...bl, toolCall: { ...bl.toolCall, result: patch.result, error: patch.error, completedAt } }
          : bl
      })
      return { ...m, toolCalls: updatedToolCalls ?? m.toolCalls, blocks: updatedBlocks ?? m.blocks }
    })
    return { messages }
  })
  persistSession(sessionId)
}

/**
 * Handle `assistant` event: complete an assistant turn.
 *
 * Merges into the existing partial message shell (if streaming created one)
 * or appends a fresh message. Detects AskUserQuestion / ExitPlanMode tool
 * calls and sets pendingQuestion / pendingPlanApproval accordingly.
 */
export function handleAssistant(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const { store, sessionId } = ctx

  stopPeriodicFlush(sessionId)
  flushStreamingBuffer(sessionId)

  const msg = ev.message as Record<string, unknown> | undefined
  if (!msg) return

  // Capture the SDK's assistant message UUID. Used as a rollback anchor by
  // the experimental rollback-history feature (passed to SDK as resumeSessionAt).
  const sdkUuid = typeof ev.uuid === 'string' ? ev.uuid : undefined

  const blocks: ContentBlock[] = extractContentBlocks(msg)
  const textContent = blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const toolCalls: ToolCall[] = blocks
    .filter((b): b is { type: 'tool_use'; toolCall: ToolCall } => b.type === 'tool_use')
    .map((b) => b.toolCall)

  if (!updateSession(store, sessionId, (current) => {
    const messages = [...current.messages]
    const lastMsg = messages[messages.length - 1]

    if (lastMsg?.role === 'assistant' && lastMsg.isPartial) {
      messages[messages.length - 1] = {
        ...lastMsg,
        sdkUuid: sdkUuid ?? lastMsg.sdkUuid,
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : lastMsg.toolCalls,
        blocks: blocks.length > 0 ? blocks : lastMsg.blocks,
        isPartial: false
      }
    } else {
      messages.push({
        id: msgId(), sdkUuid, role: 'assistant', content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        blocks: blocks.length > 0 ? blocks : undefined,
        isPartial: false, timestamp: Date.now()
      })
    }

    const pending = resolvePendingState(toolCalls, messages)
    return pending ? { messages, ...pending } : { messages }
  })) return

  persistSession(sessionId)
}
