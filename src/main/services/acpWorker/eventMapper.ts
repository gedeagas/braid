/**
 * Maps ACP SessionUpdate notifications to Braid's WorkerEvent format.
 *
 * The renderer's eventHandler.ts already handles sdk_message events with
 * subtypes: assistant, user, stream_event, tool_progress, result, system.
 * We synthesize compatible events so the renderer doesn't need any changes.
 */

import type { WorkerEvent } from '../agentTypes'

/** Tracks per-turn state for synthesizing the streaming event sequence. */
export interface TurnState {
  /** Whether we've emitted message_start for this turn. */
  started: boolean
  /** Whether we've emitted content_block_start for text. */
  textBlockStarted: boolean
  /** Whether a thinking block is currently open. */
  thinkingBlockStarted: boolean
  /** Running block index for content_block_start/stop. */
  blockIndex: number
  /** Accumulated token usage for the turn (updated by cost_update). */
  inputTokens: number
  outputTokens: number
  /** Slash commands received via available_commands_update. */
  slashCommands?: Array<{ name: string; description: string; argumentHint?: string }>
}

export function createTurnState(): TurnState {
  return {
    started: false,
    textBlockStarted: false,
    thinkingBlockStarted: false,
    blockIndex: 0,
    inputTokens: 0,
    outputTokens: 0,
  }
}

/**
 * Convert an ACP session update into WorkerEvent(s).
 * Returns an array because some updates produce multiple events.
 */
export function mapSessionUpdate(
  sessionId: string,
  update: Record<string, unknown>,
  turn: TurnState
): WorkerEvent[] {
  const events: WorkerEvent[] = []
  const kind = update.type ?? update.sessionUpdate

  switch (kind) {
    case 'agent_message_chunk': {
      // Ensure message_start is sent once per turn
      ensureMessageStarted(sessionId, turn, events)

      // Close any open thinking block before starting text
      if (turn.thinkingBlockStarted) {
        events.push(sdkMsg(sessionId, {
          type: 'stream_event',
          event: { type: 'content_block_stop', index: turn.blockIndex }
        }))
        turn.thinkingBlockStarted = false
        turn.blockIndex++
      }

      // Ensure content_block_start for text is sent once
      if (!turn.textBlockStarted) {
        turn.textBlockStarted = true
        events.push(sdkMsg(sessionId, {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: turn.blockIndex,
            content_block: { type: 'text', text: '' }
          }
        }))
      }

      // Emit text delta
      const content = update.content as Record<string, unknown> | undefined
      const text = (content?.text as string) ?? ''
      if (text) {
        events.push(sdkMsg(sessionId, {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: turn.blockIndex,
            delta: { type: 'text_delta', text }
          }
        }))
      }
      break
    }

    case 'agent_thought_chunk': {
      // Thinking blocks - the renderer shows activity indicator
      ensureMessageStarted(sessionId, turn, events)

      // Only emit content_block_start once for a contiguous thinking sequence
      if (!turn.thinkingBlockStarted) {
        turn.thinkingBlockStarted = true
        events.push(sdkMsg(sessionId, {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: turn.blockIndex,
            content_block: { type: 'thinking' }
          }
        }))
      }
      break
    }

    case 'tool_call':
    case 'tool_call_update': {
      const status = update.status as string | undefined
      // ACP spec: toolCallId; legacy: id
      const toolCallId = (update.toolCallId as string) ?? (update.id as string) ?? `acp-tc-${Date.now()}`
      // ACP spec: title is the human-readable label; fall back to toolName / name
      const toolName = (update.toolName as string) ?? (update.title as string)
        ?? (update.name as string) ?? 'unknown'

      // ACP sends 'in_progress' or 'pending'; also accept legacy 'running'/'started'
      if (status === 'in_progress' || status === 'pending' || status === 'running' || status === 'started' || !status) {
        ensureMessageStarted(sessionId, turn, events)

        // Close any open text block
        if (turn.textBlockStarted) {
          events.push(sdkMsg(sessionId, {
            type: 'stream_event',
            event: { type: 'content_block_stop', index: turn.blockIndex }
          }))
          turn.textBlockStarted = false
          turn.blockIndex++
        }

        // Close any open thinking block
        if (turn.thinkingBlockStarted) {
          events.push(sdkMsg(sessionId, {
            type: 'stream_event',
            event: { type: 'content_block_stop', index: turn.blockIndex }
          }))
          turn.thinkingBlockStarted = false
          turn.blockIndex++
        }

        // Start a tool_use block
        events.push(sdkMsg(sessionId, {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: turn.blockIndex,
            content_block: {
              type: 'tool_use',
              id: toolCallId,
              name: toolName
            }
          }
        }))
        turn.blockIndex++
      }

      if (status === 'completed' || status === 'failed') {
        // Emit content_block_stop for the tool_use block.
        // The block was started at (turn.blockIndex - 1) since blockIndex was
        // incremented immediately after content_block_start for tool_use.
        if (turn.blockIndex > 0) {
          events.push(sdkMsg(sessionId, {
            type: 'stream_event',
            event: { type: 'content_block_stop', index: turn.blockIndex - 1 }
          }))
        }

        // ACP sends content as an array; legacy sends output as a string
        const output = extractToolOutput(update)
        const isError = status === 'failed' || ((update.isError as boolean) ?? false)
        events.push(sdkMsg(sessionId, {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolCallId,
              is_error: isError,
              content: [{ type: 'text', text: output }]
            }]
          }
        }))
      }
      break
    }

    case 'cost_update': {
      // Accumulate tokens in turn state instead of emitting a duplicate message_start.
      // The renderer picks up usage from the initial message_start event.
      const inputTokens = (update.inputTokens as number) ?? 0
      const outputTokens = (update.outputTokens as number) ?? 0
      turn.inputTokens += inputTokens
      turn.outputTokens += outputTokens
      break
    }

    case 'available_commands_update': {
      // ACP sends { availableCommands: [{ name, description, input? }] }
      // Stash on turn state so the caller can emit a slash_commands event
      const cmds = update.availableCommands as Array<Record<string, unknown>> | undefined
      if (Array.isArray(cmds) && cmds.length > 0) {
        turn.slashCommands = cmds.map((cmd) => ({
          name: (cmd.name as string) ?? '',
          description: (cmd.description as string) ?? '',
          argumentHint: ((cmd.input as Record<string, unknown>)?.hint as string) ?? undefined,
        }))
      }
      break
    }

    // Plan updates, mode changes, config changes - no direct mapping needed yet
    case 'plan':
    case 'current_mode_update':
    case 'config_option_update':
      break
  }

  return events
}

/**
 * Emit the closing events for a turn (content_block_stop + result).
 */
export function finalizeTurn(sessionId: string, turn: TurnState): WorkerEvent[] {
  const events: WorkerEvent[] = []

  // Close any open thinking block
  if (turn.thinkingBlockStarted) {
    events.push(sdkMsg(sessionId, {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: turn.blockIndex }
    }))
  }

  // Close any open text block
  if (turn.textBlockStarted) {
    events.push(sdkMsg(sessionId, {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: turn.blockIndex }
    }))
  }

  // Emit final usage via message_delta (same as Claude SDK does)
  if (turn.inputTokens > 0 || turn.outputTokens > 0) {
    events.push(sdkMsg(sessionId, {
      type: 'stream_event',
      event: {
        type: 'message_delta',
        usage: {
          input_tokens: turn.inputTokens,
          output_tokens: turn.outputTokens
        }
      }
    }))
  }

  events.push(sdkMsg(sessionId, {
    type: 'result',
    subtype: 'success',
    result: '',
    is_error: false
  }))

  return events
}

// -- Helpers ----------------------------------------------------------------

/** Ensure message_start has been emitted for this turn (idempotent). */
function ensureMessageStarted(sessionId: string, turn: TurnState, events: WorkerEvent[]): void {
  if (turn.started) return
  turn.started = true
  events.push(sdkMsg(sessionId, {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: { usage: { input_tokens: 0, output_tokens: 0 } }
    }
  }))
}

/**
 * Extract human-readable output from a tool_call / tool_call_update.
 *
 * ACP spec sends `content` as an array of content blocks:
 *   [{ type: 'content', content: { type: 'text', text: '...' } }, ...]
 * Legacy agents may send a plain `output` string.
 */
function extractToolOutput(update: Record<string, unknown>): string {
  // Try ACP-spec content array first
  const contentArr = update.content as Array<Record<string, unknown>> | undefined
  if (Array.isArray(contentArr) && contentArr.length > 0) {
    const texts: string[] = []
    for (const item of contentArr) {
      // ACP wraps in { type: 'content', content: { type: 'text', text } }
      const inner = item.content as Record<string, unknown> | undefined
      if (inner?.text) {
        texts.push(inner.text as string)
      } else if (item.type === 'text' && item.text) {
        // Flat content block: { type: 'text', text: '...' }
        texts.push(item.text as string)
      }
    }
    if (texts.length > 0) return texts.join('\n')
  }

  // Fall back to legacy output string
  return (update.output as string) ?? ''
}

function sdkMsg(sessionId: string, message: unknown): WorkerEvent {
  return { type: 'sdk_message', sessionId, message }
}
