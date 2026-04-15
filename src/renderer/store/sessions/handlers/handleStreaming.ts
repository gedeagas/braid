// ---------------------------------------------------------------------------
// Streaming handlers — streamEvent, toolProgress, result
// ---------------------------------------------------------------------------

import type { ContentBlock, ToolCall, TurnUsage } from '@/types'
import type { HandlerContext } from './types'
import { accumulateTokens } from './tokenUtils'
import { updateSession, msgId } from '../stateUtils'
import { startPeriodicFlush, stopPeriodicFlush, flushStreamingBuffer } from '../streaming'
import { persistSession } from '../persistence'
import { toolActivity, thinkingActivity } from '../activity'
import { maybeShowToast, createNotificationDeps } from './notifications'
import { preCompactTokens } from './handleCompaction'
import { formatTokens } from '@/lib/constants'
import i18n from '@/lib/i18n'

/**
 * Track sessions that received streaming token updates this turn to avoid
 * double-counting in handleResult. Exported for test beforeEach cleanup.
 */
export const sessionsWithStreamingTokens = new Set<string>()

/**
 * Stash per-turn usage from message_start until the partial assistant message
 * shell is created (in content_block_start or content_block_delta).
 * message_start always fires before any content blocks, so the message doesn't
 * exist yet when usage arrives. Exported for test cleanup.
 */
export const pendingTurnUsage = new Map<string, TurnUsage>()

/** Accumulate turn usage across multi-step tool use. Keeps the latest model. */
function mergeTurnUsage(existing: TurnUsage | undefined, incoming: TurnUsage): TurnUsage {
  if (!existing) return incoming
  return {
    model: incoming.model ?? existing.model,
    inputTokens: existing.inputTokens + incoming.inputTokens,
    outputTokens: existing.outputTokens + incoming.outputTokens,
    cacheReadTokens: existing.cacheReadTokens + incoming.cacheReadTokens,
    cacheWriteTokens: existing.cacheWriteTokens + incoming.cacheWriteTokens
  }
}

// ---------------------------------------------------------------------------
// handleStreamEvent
// ---------------------------------------------------------------------------

/**
 * Handle `stream_event`: dispatches to content block sub-handlers or
 * accumulates token counts from message_start / message_delta.
 */
export function handleStreamEvent(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const { store, sessionId } = ctx

  const session = store.getState().sessions[sessionId]
  if (!session || session.status === 'waiting_input') return

  const streamEvent = ev.event as Record<string, unknown> | undefined
  if (!streamEvent) return

  switch (streamEvent.type) {
    case 'content_block_start':
      handleContentBlockStart(ctx, streamEvent)
      return

    case 'content_block_stop':
      stopPeriodicFlush(sessionId)
      flushStreamingBuffer(sessionId)
      return

    case 'content_block_delta':
      handleContentBlockDelta(ctx, streamEvent)
      return

    case 'message_start': {
      const message = streamEvent.message as Record<string, unknown> | undefined
      const usage = message?.usage as {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
      } | undefined
      if (usage) {
        sessionsWithStreamingTokens.add(sessionId)
        // Total context = non-cached + cache-read + cache-creation tokens.
        // With prompt caching, input_tokens alone is only the non-cached portion.
        const totalContext = (usage.input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0)
        const postTokens = totalContext
        const preTokens = preCompactTokens.get(sessionId)

        // Stash per-turn usage - will be attached to the assistant message
        // when its shell is created in content_block_start / content_block_delta.
        const model = message?.model as string | undefined
        pendingTurnUsage.set(sessionId, {
          model,
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0
        })

        updateSession(store, sessionId, (current) => {
          const base = {
            tokenUsage: accumulateTokens(current.tokenUsage, usage),
            // Replace (not accumulate) - this is the actual context window usage
            // for the current turn. After /compact, this drops to the new size.
            contextTokens: totalContext > 0 ? totalContext : current.contextTokens
          }

          // If we just compacted, patch the boundary message with before->after
          if (preTokens != null && postTokens != null) {
            const updatedContent = i18n.t('compactBoundaryReduction', {
              ns: 'center',
              before: formatTokens(preTokens),
              after: formatTokens(postTokens)
            })
            const messages = [...current.messages]
            for (let idx = messages.length - 1; idx >= 0; idx--) {
              if (messages[idx].tag === 'compact-boundary') {
                messages[idx] = { ...messages[idx], content: updatedContent }
                break
              }
            }
            return { ...base, messages }
          }

          return base
        })

        // Clean up the stash after consuming it
        if (preTokens != null) {
          preCompactTokens.delete(sessionId)
          persistSession(sessionId)
        }
      }
      return
    }

    case 'message_delta': {
      const usage = streamEvent.usage as { output_tokens?: number } | undefined
      if (usage) {
        sessionsWithStreamingTokens.add(sessionId)
        updateSession(store, sessionId, (current) => {
          const base = { tokenUsage: accumulateTokens(current.tokenUsage, usage) }
          // Accumulate output tokens on the last partial assistant message's turnUsage
          if (usage.output_tokens) {
            const messages = [...current.messages]
            for (let idx = messages.length - 1; idx >= 0; idx--) {
              const m = messages[idx]
              if (m.role === 'assistant' && m.isPartial && m.turnUsage) {
                messages[idx] = {
                  ...m,
                  turnUsage: {
                    ...m.turnUsage,
                    outputTokens: m.turnUsage.outputTokens + usage.output_tokens
                  }
                }
                return { ...base, messages }
              }
            }
          }
          return base
        })
      }
      return
    }
  }
}

// ---------------------------------------------------------------------------
// handleContentBlockStart (exported for testing)
// ---------------------------------------------------------------------------

export function handleContentBlockStart(
  ctx: HandlerContext,
  streamEvent: Record<string, unknown>
): void {
  const { store, sessionId } = ctx
  const contentBlock = streamEvent.content_block as Record<string, unknown> | undefined

  if (contentBlock?.type === 'thinking') {
    updateSession(store, sessionId, () => ({ activity: thinkingActivity() }))
    return
  }

  if (contentBlock?.type === 'tool_use') {
    stopPeriodicFlush(sessionId)
    flushStreamingBuffer(sessionId)

    const toolName = (contentBlock.name as string) ?? 'tool'
    const toolId = (contentBlock.id as string) ?? `tc-streaming-${Date.now()}`
    const placeholderToolCall: ToolCall = { id: toolId, name: toolName, input: '', startedAt: Date.now() }
    const placeholderBlock: ContentBlock = { type: 'tool_use', toolCall: placeholderToolCall }

    updateSession(store, sessionId, (current) => {
      const messages = [...current.messages]
      const lastMsg = messages[messages.length - 1]
      const stashedUsage = pendingTurnUsage.get(sessionId)

      if (lastMsg?.role === 'assistant' && lastMsg.isPartial) {
        const existingBlocks = lastMsg.blocks ?? []
        if (!existingBlocks.some((bl) => bl.type === 'tool_use' && bl.toolCall.id === toolId)) {
          // Accumulate turnUsage across multi-step tool use (each API call fires message_start)
          const mergedUsage = stashedUsage
            ? mergeTurnUsage(lastMsg.turnUsage, stashedUsage)
            : lastMsg.turnUsage
          messages[messages.length - 1] = {
            ...lastMsg,
            blocks: [...existingBlocks, placeholderBlock],
            toolCalls: [...(lastMsg.toolCalls ?? []), placeholderToolCall],
            turnUsage: mergedUsage
          }
        }
      } else {
        messages.push({
          id: msgId(), role: 'assistant', content: '',
          blocks: [placeholderBlock], toolCalls: [placeholderToolCall],
          isPartial: true, timestamp: Date.now(),
          turnUsage: stashedUsage
        })
      }
      if (stashedUsage) pendingTurnUsage.delete(sessionId)
      return { activity: toolActivity(toolName, 'calling'), messages }
    })
    return
  }

  if (contentBlock?.type === 'text') {
    flushStreamingBuffer(sessionId)
    updateSession(store, sessionId, () => ({ activity: 'Writing...' }))
  }
}

// ---------------------------------------------------------------------------
// handleContentBlockDelta (exported for testing)
// ---------------------------------------------------------------------------

export function handleContentBlockDelta(
  ctx: HandlerContext,
  streamEvent: Record<string, unknown>
): void {
  const { store, sessionId } = ctx
  const delta = streamEvent.delta as Record<string, unknown> | undefined
  if (delta?.type === 'thinking_delta') return

  const deltaText = delta?.type === 'text_delta' ? ((delta.text as string) ?? '') : ''
  if (!deltaText) return

  // Ensure a partial message shell exists (created once, not on every delta)
  if (!updateSession(store, sessionId, (current) => {
    const lastMsg = current.messages[current.messages.length - 1]
    if (lastMsg?.role === 'assistant' && lastMsg.isPartial) return {}
    const stashedUsage = pendingTurnUsage.get(sessionId)
    if (stashedUsage) pendingTurnUsage.delete(sessionId)
    return {
      activity: 'Writing...',
      messages: [...current.messages, {
        id: msgId(), role: 'assistant' as const, content: '',
        isPartial: true, timestamp: Date.now(),
        turnUsage: stashedUsage
      }]
    }
  })) return

  // Buffer the text — avoids a re-render per keystroke
  store.setState((s) => ({
    streamingTextBuffers: {
      ...s.streamingTextBuffers,
      [sessionId]: (s.streamingTextBuffers[sessionId] ?? '') + deltaText
    }
  }))
  startPeriodicFlush(sessionId)
}

// ---------------------------------------------------------------------------
// handleToolProgress
// ---------------------------------------------------------------------------

/**
 * Update activity string with the current tool's running state and elapsed time.
 */
export function handleToolProgress(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const { store, sessionId } = ctx
  const toolName = (ev.tool_name as string) ?? 'tool'
  const elapsed = (ev.elapsed_time_seconds as number) ?? 0
  updateSession(store, sessionId, (c) =>
    c.status === 'waiting_input' ? {} : { activity: toolActivity(toolName, 'running', elapsed) }
  )
}

// ---------------------------------------------------------------------------
// handleResult
// ---------------------------------------------------------------------------

/**
 * Finalize a message turn: append result text (if any), handle errors,
 * and accumulate token counts — skipping tokens already counted via streaming.
 */
export function handleResult(ctx: HandlerContext, ev: Record<string, unknown>): void {
  const { store, sessionId } = ctx

  const session = store.getState().sessions[sessionId]
  if (!session) return

  // Never overwrite waiting_input — a blocking tool (AskUserQuestion,
  // ExitPlanMode, ToolPermission) is active and only the user's response
  // should clear it. Without this guard a `result` event arriving after
  // handleAssistant sets waiting_input stomps the status back to idle,
  // causing the session to land in the "done" kanban column while the
  // question is still visible in the chat.
  if (session.status === 'waiting_input') return

  // Delete returns true if the session was in the set — meaning streaming
  // already accumulated tokens for this turn; skip to avoid double-counting.
  const alreadyCounted = sessionsWithStreamingTokens.delete(sessionId)
  const usage = alreadyCounted
    ? undefined
    : ev.usage as { input_tokens?: number; output_tokens?: number } | undefined
  const resultText = (ev.result as string) ?? ''

  if (resultText && ev.subtype === 'success') {
    if (!updateSession(store, sessionId, (current) => {
      const elapsed = current.runStartedAt ? Date.now() - current.runStartedAt : 0
      const turnDurationMs = elapsed > 0 ? elapsed : undefined
      const lastMsg = current.messages[current.messages.length - 1]
      const base = {
        status: 'idle' as const,
        runStartedAt: null,
        totalRunDurationMs: (current.totalRunDurationMs ?? 0) + elapsed,
        // Only update tokenUsage when there's actual data to accumulate —
        // preserves null rather than upgrading it to {0,0} with no data
        tokenUsage: usage != null ? accumulateTokens(current.tokenUsage, usage) : current.tokenUsage
      }
      // De-duplicate: skip append if result already equals last message.
      // Stamp turnDurationMs on the existing partial message (turnUsage was set during streaming).
      if (lastMsg && lastMsg.content === resultText) {
        if (turnDurationMs != null) {
          const messages = [...current.messages]
          messages[messages.length - 1] = { ...lastMsg, turnDurationMs }
          return { ...base, messages }
        }
        return base
      }
      // Inherit turnUsage from the last partial assistant message, or from pending stash
      const stashedUsage = pendingTurnUsage.get(sessionId)
      if (stashedUsage) pendingTurnUsage.delete(sessionId)
      const partialMsg = (lastMsg?.role === 'assistant' && lastMsg.isPartial) ? lastMsg : undefined
      const turnUsage = partialMsg?.turnUsage ?? stashedUsage
      return {
        ...base,
        messages: [...current.messages, {
          id: msgId('result'), role: 'assistant' as const,
          content: resultText, timestamp: Date.now(),
          turnDurationMs,
          turnUsage
        }]
      }
    })) return
    persistSession(sessionId)
    return
  }

  if (ev.is_error) {
    const errors = (ev.errors as string[]) ?? []
    if (errors.length > 0) {
      updateSession(store, sessionId, (current) => {
        const elapsed = current.runStartedAt ? Date.now() - current.runStartedAt : 0
        return {
          status: 'error' as const,
          runStartedAt: null,
          totalRunDurationMs: (current.totalRunDurationMs ?? 0) + elapsed,
          tokenUsage: usage != null ? accumulateTokens(current.tokenUsage, usage) : current.tokenUsage,
          messages: [...current.messages, {
            id: msgId('err'), role: 'system' as const,
            content: errors.join('\n'), timestamp: Date.now()
          }]
        }
      })
      persistSession(sessionId)
      maybeShowToast(sessionId, 'error', createNotificationDeps())
      return
    }
  }

  // Token-only update (no result text, no error)
  if (usage) {
    updateSession(store, sessionId, (current) => ({
      tokenUsage: accumulateTokens(current.tokenUsage, usage)
    }))
  }
}

