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
  /** Running block index for content_block_start/stop. */
  blockIndex: number
}

export function createTurnState(): TurnState {
  return { started: false, textBlockStarted: false, blockIndex: 0 }
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
      if (!turn.started) {
        turn.started = true
        events.push(sdkMsg(sessionId, {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: { usage: { input_tokens: 0, output_tokens: 0 } }
          }
        }))
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
      // Thinking blocks - the renderer shows activity but ignores the content
      if (!turn.started) {
        turn.started = true
        events.push(sdkMsg(sessionId, {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: { usage: { input_tokens: 0, output_tokens: 0 } }
          }
        }))
      }
      // Emit a thinking content_block_start so the renderer shows "Thinking..."
      events.push(sdkMsg(sessionId, {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: turn.blockIndex,
          content_block: { type: 'thinking' }
        }
      }))
      break
    }

    case 'tool_call': {
      const status = update.status as string | undefined
      const toolCallId = (update.id as string) ?? `acp-tc-${Date.now()}`
      const toolName = (update.name as string) ?? 'unknown'

      if (status === 'running' || status === 'started' || !status) {
        // Close any open text block
        if (turn.textBlockStarted) {
          events.push(sdkMsg(sessionId, {
            type: 'stream_event',
            event: { type: 'content_block_stop', index: turn.blockIndex }
          }))
          turn.textBlockStarted = false
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

      if (status === 'completed') {
        const output = update.output as string | undefined
        const isError = (update.isError as boolean) ?? false
        events.push(sdkMsg(sessionId, {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolCallId,
              is_error: isError,
              content: [{ type: 'text', text: output ?? '' }]
            }]
          }
        }))
      }
      break
    }

    case 'cost_update': {
      const inputTokens = (update.inputTokens as number) ?? 0
      const outputTokens = (update.outputTokens as number) ?? 0
      if (inputTokens > 0 || outputTokens > 0) {
        events.push(sdkMsg(sessionId, {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: {
              usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens
              }
            }
          }
        }))
      }
      break
    }

    // Plan updates, mode changes, config changes - no direct mapping needed yet
    case 'plan':
    case 'current_mode_update':
    case 'config_option_update':
    case 'available_commands_update':
      break
  }

  return events
}

/**
 * Emit the closing events for a turn (content_block_stop + result).
 */
export function finalizeTurn(sessionId: string, turn: TurnState): WorkerEvent[] {
  const events: WorkerEvent[] = []

  if (turn.textBlockStarted) {
    events.push(sdkMsg(sessionId, {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: turn.blockIndex }
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

function sdkMsg(sessionId: string, message: unknown): WorkerEvent {
  return { type: 'sdk_message', sessionId, message }
}
