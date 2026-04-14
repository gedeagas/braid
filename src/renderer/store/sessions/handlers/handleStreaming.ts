// ---------------------------------------------------------------------------
// Streaming handlers — streamEvent, toolProgress, result
// ---------------------------------------------------------------------------

import type { ContentBlock, ToolCall } from '@/types'
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
        updateSession(store, sessionId, (current) => ({
          tokenUsage: accumulateTokens(current.tokenUsage, usage)
        }))
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

      if (lastMsg?.role === 'assistant' && lastMsg.isPartial) {
        const existingBlocks = lastMsg.blocks ?? []
        if (!existingBlocks.some((bl) => bl.type === 'tool_use' && bl.toolCall.id === toolId)) {
          messages[messages.length - 1] = {
            ...lastMsg,
            blocks: [...existingBlocks, placeholderBlock],
            toolCalls: [...(lastMsg.toolCalls ?? []), placeholderToolCall]
          }
        }
      } else {
        messages.push({
          id: msgId(), role: 'assistant', content: '',
          blocks: [placeholderBlock], toolCalls: [placeholderToolCall],
          isPartial: true, timestamp: Date.now()
        })
      }
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
    return {
      activity: 'Writing...',
      messages: [...current.messages, {
        id: msgId(), role: 'assistant' as const, content: '',
        isPartial: true, timestamp: Date.now()
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
      const lastMsg = current.messages[current.messages.length - 1]
      const base = {
        status: 'idle' as const,
        runStartedAt: null,
        totalRunDurationMs: (current.totalRunDurationMs ?? 0) + elapsed,
        // Only update tokenUsage when there's actual data to accumulate —
        // preserves null rather than upgrading it to {0,0} with no data
        tokenUsage: usage != null ? accumulateTokens(current.tokenUsage, usage) : current.tokenUsage
      }
      // De-duplicate: skip append if result already equals last message
      if (lastMsg && lastMsg.content === resultText) return base
      return {
        ...base,
        messages: [...current.messages, {
          id: msgId('result'), role: 'assistant' as const,
          content: resultText, timestamp: Date.now()
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

