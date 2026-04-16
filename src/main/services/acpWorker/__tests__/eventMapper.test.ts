import { describe, it, expect, beforeEach } from 'vitest'
import { mapSessionUpdate, finalizeTurn, createTurnState, type TurnState } from '../eventMapper'

const SID = 'test-session-1'

/** Extract the inner message from a WorkerEvent for assertions. */
function msg(event: { type: string; message?: unknown }): Record<string, unknown> {
  return event.message as Record<string, unknown>
}

/** Narrow to the `event` field inside a stream_event message. */
function streamEvent(event: { type: string; message?: unknown }): Record<string, unknown> {
  const m = msg(event) as { event?: Record<string, unknown> }
  return m.event!
}

let turn: TurnState

beforeEach(() => {
  turn = createTurnState()
})

// ---------------------------------------------------------------------------
describe('createTurnState', () => {
  it('returns a fresh state with all fields zeroed', () => {
    expect(turn).toEqual({
      started: false,
      textBlockStarted: false,
      thinkingBlockStarted: false,
      blockIndex: 0,
      inputTokens: 0,
      outputTokens: 0,
    })
  })
})

// ---------------------------------------------------------------------------
describe('mapSessionUpdate - agent_message_chunk', () => {
  it('emits message_start + content_block_start on first chunk', () => {
    const events = mapSessionUpdate(SID, {
      type: 'agent_message_chunk',
      content: { text: 'Hello' },
    }, turn)

    expect(events).toHaveLength(3)
    expect(streamEvent(events[0]).type).toBe('message_start')
    expect(streamEvent(events[1]).type).toBe('content_block_start')
    expect((streamEvent(events[1]).content_block as Record<string, unknown>).type).toBe('text')
    expect(streamEvent(events[2]).type).toBe('content_block_delta')
    expect((streamEvent(events[2]).delta as Record<string, unknown>).text).toBe('Hello')
  })

  it('emits only text delta on subsequent chunks', () => {
    mapSessionUpdate(SID, { type: 'agent_message_chunk', content: { text: 'A' } }, turn)
    const events = mapSessionUpdate(SID, { type: 'agent_message_chunk', content: { text: 'B' } }, turn)

    expect(events).toHaveLength(1)
    expect(streamEvent(events[0]).type).toBe('content_block_delta')
    expect((streamEvent(events[0]).delta as Record<string, unknown>).text).toBe('B')
  })

  it('skips delta when text is empty', () => {
    const events = mapSessionUpdate(SID, {
      type: 'agent_message_chunk',
      content: { text: '' },
    }, turn)

    // message_start + content_block_start but no delta
    expect(events).toHaveLength(2)
    expect(streamEvent(events[0]).type).toBe('message_start')
    expect(streamEvent(events[1]).type).toBe('content_block_start')
  })

  it('closes a thinking block before starting text', () => {
    mapSessionUpdate(SID, { type: 'agent_thought_chunk' }, turn)
    expect(turn.thinkingBlockStarted).toBe(true)

    const events = mapSessionUpdate(SID, {
      type: 'agent_message_chunk',
      content: { text: 'answer' },
    }, turn)

    // content_block_stop (thinking) + content_block_start (text) + delta
    expect(events).toHaveLength(3)
    expect(streamEvent(events[0]).type).toBe('content_block_stop')
    expect(streamEvent(events[1]).type).toBe('content_block_start')
    expect((streamEvent(events[1]).content_block as Record<string, unknown>).type).toBe('text')
    expect(turn.thinkingBlockStarted).toBe(false)
  })

  it('reads text from content.text field', () => {
    const events = mapSessionUpdate(SID, {
      type: 'agent_message_chunk',
      content: { text: 'deep nested' },
    }, turn)

    const delta = events.find((e) => streamEvent(e)?.type === 'content_block_delta')
    expect((streamEvent(delta!).delta as Record<string, unknown>).text).toBe('deep nested')
  })
})

// ---------------------------------------------------------------------------
describe('mapSessionUpdate - agent_thought_chunk', () => {
  it('emits message_start + thinking block_start on first chunk', () => {
    const events = mapSessionUpdate(SID, { type: 'agent_thought_chunk' }, turn)

    expect(events).toHaveLength(2)
    expect(streamEvent(events[0]).type).toBe('message_start')
    expect(streamEvent(events[1]).type).toBe('content_block_start')
    expect((streamEvent(events[1]).content_block as Record<string, unknown>).type).toBe('thinking')
    expect(turn.thinkingBlockStarted).toBe(true)
  })

  it('does not emit duplicate thinking block_start on subsequent chunks', () => {
    mapSessionUpdate(SID, { type: 'agent_thought_chunk' }, turn)
    const events = mapSessionUpdate(SID, { type: 'agent_thought_chunk' }, turn)

    expect(events).toHaveLength(0)
  })

  it('increments blockIndex correctly when thinking transitions to text', () => {
    mapSessionUpdate(SID, { type: 'agent_thought_chunk' }, turn)
    expect(turn.blockIndex).toBe(0) // thinking block at index 0

    mapSessionUpdate(SID, { type: 'agent_message_chunk', content: { text: 'x' } }, turn)
    // After closing thinking (index 0 stop, blockIndex becomes 1), text starts at index 1
    expect(turn.blockIndex).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('mapSessionUpdate - tool_call', () => {
  it('emits tool_use content_block_start on running status', () => {
    const events = mapSessionUpdate(SID, {
      type: 'tool_call',
      status: 'running',
      id: 'tc-1',
      name: 'ReadFile',
    }, turn)

    // message_start + tool_use block_start
    expect(events).toHaveLength(2)
    expect(streamEvent(events[0]).type).toBe('message_start')
    const block = streamEvent(events[1])
    expect(block.type).toBe('content_block_start')
    expect((block.content_block as Record<string, unknown>).type).toBe('tool_use')
    expect((block.content_block as Record<string, unknown>).id).toBe('tc-1')
    expect((block.content_block as Record<string, unknown>).name).toBe('ReadFile')
  })

  it('closes open text block before starting tool_use', () => {
    mapSessionUpdate(SID, { type: 'agent_message_chunk', content: { text: 'hi' } }, turn)
    expect(turn.textBlockStarted).toBe(true)

    const events = mapSessionUpdate(SID, {
      type: 'tool_call',
      status: 'running',
      id: 'tc-2',
      name: 'Write',
    }, turn)

    // content_block_stop (text) + tool_use block_start
    expect(events).toHaveLength(2)
    expect(streamEvent(events[0]).type).toBe('content_block_stop')
    expect(streamEvent(events[1]).type).toBe('content_block_start')
    expect(turn.textBlockStarted).toBe(false)
  })

  it('closes open thinking block before starting tool_use', () => {
    mapSessionUpdate(SID, { type: 'agent_thought_chunk' }, turn)
    expect(turn.thinkingBlockStarted).toBe(true)

    const events = mapSessionUpdate(SID, {
      type: 'tool_call',
      status: 'started',
      id: 'tc-3',
      name: 'Edit',
    }, turn)

    // content_block_stop (thinking) + tool_use block_start
    expect(events).toHaveLength(2)
    expect(streamEvent(events[0]).type).toBe('content_block_stop')
    expect(streamEvent(events[1]).type).toBe('content_block_start')
    expect(turn.thinkingBlockStarted).toBe(false)
  })

  it('emits content_block_stop + tool_result on completed status', () => {
    // First start the tool_use block so blockIndex advances
    mapSessionUpdate(SID, {
      type: 'tool_call',
      status: 'running',
      id: 'tc-4',
      name: 'ReadFile',
    }, turn)
    expect(turn.blockIndex).toBe(1) // tool_use block was at index 0, blockIndex now 1

    const events = mapSessionUpdate(SID, {
      type: 'tool_call',
      status: 'completed',
      id: 'tc-4',
      output: 'file contents',
      isError: false,
    }, turn)

    // content_block_stop for the tool_use block (index 0) + tool_result
    expect(events).toHaveLength(2)
    expect(streamEvent(events[0]).type).toBe('content_block_stop')
    expect(streamEvent(events[0]).index).toBe(0) // tool_use block index

    const m = msg(events[1]) as Record<string, unknown>
    expect(m.type).toBe('user')
    const inner = m.message as Record<string, unknown>
    expect(inner.role).toBe('user')
    const content = (inner.content as Array<Record<string, unknown>>)[0]
    expect(content.type).toBe('tool_result')
    expect(content.tool_use_id).toBe('tc-4')
    expect(content.is_error).toBe(false)
  })

  it('handles tool_call with no status (defaults to running)', () => {
    const events = mapSessionUpdate(SID, {
      type: 'tool_call',
      id: 'tc-5',
      name: 'Bash',
    }, turn)

    // message_start + tool_use block_start
    expect(events).toHaveLength(2)
    expect(streamEvent(events[1]).type).toBe('content_block_start')
  })

  it('increments blockIndex for each tool_use block', () => {
    mapSessionUpdate(SID, { type: 'tool_call', status: 'running', id: 'a', name: 'A' }, turn)
    expect(turn.blockIndex).toBe(1)
    mapSessionUpdate(SID, { type: 'tool_call', status: 'running', id: 'b', name: 'B' }, turn)
    expect(turn.blockIndex).toBe(2)
  })
})

// ---------------------------------------------------------------------------
describe('mapSessionUpdate - cost_update', () => {
  it('accumulates tokens in turn state without emitting events', () => {
    const events = mapSessionUpdate(SID, {
      type: 'cost_update',
      inputTokens: 100,
      outputTokens: 50,
    }, turn)

    expect(events).toHaveLength(0)
    expect(turn.inputTokens).toBe(100)
    expect(turn.outputTokens).toBe(50)
  })

  it('accumulates across multiple cost updates', () => {
    mapSessionUpdate(SID, { type: 'cost_update', inputTokens: 100, outputTokens: 50 }, turn)
    mapSessionUpdate(SID, { type: 'cost_update', inputTokens: 200, outputTokens: 100 }, turn)

    expect(turn.inputTokens).toBe(300)
    expect(turn.outputTokens).toBe(150)
  })
})

// ---------------------------------------------------------------------------
describe('mapSessionUpdate - no-op types', () => {
  it.each(['plan', 'current_mode_update', 'config_option_update', 'available_commands_update'])(
    'returns empty array for %s',
    (type) => {
      const events = mapSessionUpdate(SID, { type }, turn)
      expect(events).toHaveLength(0)
    }
  )

  it('returns empty array for unknown types', () => {
    const events = mapSessionUpdate(SID, { type: 'totally_unknown' }, turn)
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('mapSessionUpdate - sessionUpdate key', () => {
  it('reads kind from sessionUpdate field when type is missing', () => {
    const events = mapSessionUpdate(SID, {
      sessionUpdate: 'agent_message_chunk',
      content: { text: 'via sessionUpdate' },
    }, turn)

    expect(events.length).toBeGreaterThan(0)
    const delta = events.find((e) => streamEvent(e)?.type === 'content_block_delta')
    expect(delta).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
describe('finalizeTurn', () => {
  it('emits content_block_stop for open text block + result', () => {
    mapSessionUpdate(SID, { type: 'agent_message_chunk', content: { text: 'x' } }, turn)
    const events = finalizeTurn(SID, turn)

    const types = events.map((e) => {
      const m = msg(e)
      if (m.type === 'stream_event') return (m as { event: Record<string, unknown> }).event.type
      return m.subtype ?? m.type
    })
    expect(types).toContain('content_block_stop')
    expect(types).toContain('success')
  })

  it('emits content_block_stop for open thinking block', () => {
    mapSessionUpdate(SID, { type: 'agent_thought_chunk' }, turn)
    const events = finalizeTurn(SID, turn)

    const stopEvents = events.filter((e) => streamEvent(e)?.type === 'content_block_stop')
    expect(stopEvents).toHaveLength(1)
  })

  it('emits message_delta with accumulated usage', () => {
    mapSessionUpdate(SID, { type: 'cost_update', inputTokens: 500, outputTokens: 200 }, turn)
    const events = finalizeTurn(SID, turn)

    const delta = events.find((e) => streamEvent(e)?.type === 'message_delta')
    expect(delta).toBeDefined()
    const usage = (streamEvent(delta!).usage as Record<string, number>)
    expect(usage.input_tokens).toBe(500)
    expect(usage.output_tokens).toBe(200)
  })

  it('omits message_delta when no tokens accumulated', () => {
    const events = finalizeTurn(SID, turn)
    const delta = events.find((e) => {
      const m = msg(e)
      return m.type === 'stream_event' && (m as { event: Record<string, unknown> }).event?.type === 'message_delta'
    })
    expect(delta).toBeUndefined()
  })

  it('always emits a result event', () => {
    const events = finalizeTurn(SID, turn)
    const result = events.find((e) => msg(e).type === 'result')
    expect(result).toBeDefined()
    expect(msg(result!).subtype).toBe('success')
    expect(msg(result!).is_error).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('full turn scenario: thinking -> text -> tool -> text', () => {
  it('produces correct blockIndex sequence', () => {
    // Thinking at index 0
    mapSessionUpdate(SID, { type: 'agent_thought_chunk' }, turn)
    expect(turn.blockIndex).toBe(0)

    // Text closes thinking (stop index 0, blockIndex -> 1), text starts at index 1
    mapSessionUpdate(SID, { type: 'agent_message_chunk', content: { text: 'Let me check' } }, turn)
    expect(turn.blockIndex).toBe(1)

    // Tool closes text (stop index 1, blockIndex -> 2), tool at index 2, blockIndex -> 3
    mapSessionUpdate(SID, { type: 'tool_call', status: 'running', id: 'tc', name: 'Read' }, turn)
    expect(turn.blockIndex).toBe(3)

    // Tool result (no index change)
    mapSessionUpdate(SID, { type: 'tool_call', status: 'completed', id: 'tc', output: 'ok' }, turn)
    expect(turn.blockIndex).toBe(3)

    // New text at index 3
    mapSessionUpdate(SID, { type: 'agent_message_chunk', content: { text: 'Done' } }, turn)
    expect(turn.blockIndex).toBe(3) // text block still open at 3
  })
})
