import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import type { AgentSession } from '@/types'

vi.mock('../persistence', () => ({ persistSession: vi.fn(), bindSessionsStore: vi.fn() }))
vi.mock('../streaming', () => ({
  startPeriodicFlush: vi.fn(),
  stopPeriodicFlush: vi.fn(),
  flushStreamingBuffer: vi.fn()
}))
// Return deterministic strings regardless of funny/boring ui setting
vi.mock('../activity', () => ({
  toolActivity: (name: string, phase: string) => `${name}:${phase}`,
  thinkingActivity: () => 'thinking'
}))

import {
  handleStreamEvent,
  handleContentBlockStart,
  handleContentBlockDelta,
  handleToolProgress,
  handleResult,
  sessionsWithStreamingTokens
} from '../handlers/handleStreaming'
import { preCompactTokens } from '../handlers/handleCompaction'
import { persistSession } from '../persistence'
import type { HandlerContext } from '../handlers/types'

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-1', worktreeId: 'wt-1', name: 'My Session', customName: false,
    status: 'running', model: 'claude-sonnet-4-6', thinkingEnabled: false,
    extendedContext: false, planModeEnabled: false, messages: [], activity: null,
    runStartedAt: Date.now() - 2000, runCompletedAt: null, totalRunDurationMs: 0,
    tokenUsage: null, contextTokens: null, createdAt: Date.now(), ...overrides
  }
}

function makeStore(session: Partial<AgentSession> = {}) {
  return create<{ sessions: Record<string, AgentSession>; queuedMessages: Record<string, unknown>; streamingTextBuffers: Record<string, string>; sendMessage: () => void }>()(() => ({
    sessions: { 'sess-1': makeSession(session) },
    queuedMessages: {},
    streamingTextBuffers: {},
    sendMessage: vi.fn()
  })) as unknown as import('../stateUtils').Store
}

function makeCtx(store: import('../stateUtils').Store): HandlerContext {
  return { store, sessionId: 'sess-1' }
}

function getSession(store: import('../stateUtils').Store): AgentSession {
  return (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
}

function getBuffers(store: import('../stateUtils').Store): Record<string, string> {
  return (store.getState() as { streamingTextBuffers: Record<string, string> }).streamingTextBuffers
}

beforeEach(() => {
  sessionsWithStreamingTokens.clear()
  preCompactTokens.clear()
  vi.mocked(persistSession).mockClear()
})

// ---------------------------------------------------------------------------
// handleStreamEvent — token accumulation
// ---------------------------------------------------------------------------

describe('handleStreamEvent (message_start)', () => {
  it('accumulates input tokens from message_start', () => {
    const store = makeStore()
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } }
    })
    expect(getSession(store).tokenUsage?.input).toBe(100)
  })

  it('adds session to sessionsWithStreamingTokens', () => {
    const store = makeStore()
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } }
    })
    expect(sessionsWithStreamingTokens.has('sess-1')).toBe(true)
  })

  it('sets contextTokens to total of all input token fields (not accumulated)', () => {
    const store = makeStore()
    // First turn: 100 input tokens (no caching)
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } }
    })
    expect(getSession(store).contextTokens).toBe(100)

    // Second turn: 150 input tokens — contextTokens should be replaced, not added
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 150, output_tokens: 0 } } }
    })
    expect(getSession(store).contextTokens).toBe(150)
    // tokenUsage.input should still accumulate
    expect(getSession(store).tokenUsage?.input).toBe(250)
  })

  it('includes cache_read and cache_creation tokens in contextTokens', () => {
    const store = makeStore()
    // With prompt caching: input_tokens is only non-cached portion
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: {
        input_tokens: 500,
        output_tokens: 0,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 500
      } } }
    })
    // Total context = 500 + 9000 + 500 = 10000
    expect(getSession(store).contextTokens).toBe(10_000)
  })

  it('contextTokens drops after /compact (simulated smaller context)', () => {
    const store = makeStore({ contextTokens: 180_000 })
    // After compact, the SDK sends a much smaller input_tokens
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 50_000, output_tokens: 0 } } }
    })
    expect(getSession(store).contextTokens).toBe(50_000)
  })

  it('does not add to set when no usage data', () => {
    const store = makeStore()
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: {} }
    })
    expect(sessionsWithStreamingTokens.has('sess-1')).toBe(false)
  })
})

describe('handleStreamEvent (message_delta)', () => {
  it('accumulates output tokens from message_delta', () => {
    const store = makeStore()
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_delta', usage: { output_tokens: 50 } }
    })
    expect(getSession(store).tokenUsage?.output).toBe(50)
    expect(sessionsWithStreamingTokens.has('sess-1')).toBe(true)
  })
})

describe('handleStreamEvent — skips when waiting_input', () => {
  it('does nothing when session status is waiting_input', () => {
    const store = makeStore({ status: 'waiting_input' })
    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 100 } } }
    })
    expect(getSession(store).tokenUsage).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// handleContentBlockStart
// ---------------------------------------------------------------------------

describe('handleContentBlockStart (thinking)', () => {
  it('sets activity to thinking message', () => {
    const store = makeStore()
    handleContentBlockStart(makeCtx(store), { content_block: { type: 'thinking' } })
    expect(getSession(store).activity).toBeTruthy()
  })
})

describe('handleContentBlockStart (tool_use)', () => {
  it('creates a partial message with placeholder tool call', () => {
    const store = makeStore()
    handleContentBlockStart(makeCtx(store), {
      content_block: { type: 'tool_use', id: 'tc-stream-1', name: 'Bash' }
    })
    const s = getSession(store)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].isPartial).toBe(true)
    expect(s.messages[0].toolCalls?.[0].name).toBe('Bash')
    expect(s.messages[0].toolCalls?.[0].id).toBe('tc-stream-1')
  })

  it('adds placeholder to existing partial message', () => {
    const existingPartial = {
      id: 'p-1', role: 'assistant' as const, content: 'hello',
      isPartial: true, timestamp: Date.now()
    }
    const store = makeStore({ messages: [existingPartial] })
    handleContentBlockStart(makeCtx(store), {
      content_block: { type: 'tool_use', id: 'tc-2', name: 'Read' }
    })
    const s = getSession(store)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].toolCalls).toHaveLength(1)
  })

  it('does not duplicate tool call if already in partial', () => {
    const existingPartial = {
      id: 'p-1', role: 'assistant' as const, content: '',
      isPartial: true, timestamp: Date.now(),
      blocks: [{ type: 'tool_use' as const, toolCall: { id: 'tc-dup', name: 'Bash', input: '' } }],
      toolCalls: [{ id: 'tc-dup', name: 'Bash', input: '' }]
    }
    const store = makeStore({ messages: [existingPartial] })
    handleContentBlockStart(makeCtx(store), {
      content_block: { type: 'tool_use', id: 'tc-dup', name: 'Bash' }
    })
    const s = getSession(store)
    expect(s.messages[0].toolCalls).toHaveLength(1)
  })

  it('sets activity to calling message', () => {
    const store = makeStore()
    handleContentBlockStart(makeCtx(store), {
      content_block: { type: 'tool_use', id: 'tc-1', name: 'Write' }
    })
    expect(getSession(store).activity).toContain('Write')
  })
})

describe('handleContentBlockStart (text)', () => {
  it('sets activity to Writing...', () => {
    const store = makeStore()
    handleContentBlockStart(makeCtx(store), { content_block: { type: 'text' } })
    expect(getSession(store).activity).toBe('Writing...')
  })
})

// ---------------------------------------------------------------------------
// handleContentBlockDelta
// ---------------------------------------------------------------------------

describe('handleContentBlockDelta', () => {
  it('buffers text delta into streamingTextBuffers', () => {
    const store = makeStore()
    handleContentBlockDelta(makeCtx(store), {
      delta: { type: 'text_delta', text: 'Hello ' }
    })
    handleContentBlockDelta(makeCtx(store), {
      delta: { type: 'text_delta', text: 'world' }
    })
    expect(getBuffers(store)['sess-1']).toBe('Hello world')
  })

  it('creates a partial message shell if none exists', () => {
    const store = makeStore()
    handleContentBlockDelta(makeCtx(store), {
      delta: { type: 'text_delta', text: 'hi' }
    })
    const s = getSession(store)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].isPartial).toBe(true)
    expect(s.messages[0].role).toBe('assistant')
  })

  it('does not create duplicate shell when partial already exists', () => {
    const partial = { id: 'p-1', role: 'assistant' as const, content: '', isPartial: true, timestamp: Date.now() }
    const store = makeStore({ messages: [partial] })
    handleContentBlockDelta(makeCtx(store), {
      delta: { type: 'text_delta', text: 'more text' }
    })
    const s = getSession(store)
    expect(s.messages).toHaveLength(1)
  })

  it('ignores thinking_delta', () => {
    const store = makeStore()
    handleContentBlockDelta(makeCtx(store), {
      delta: { type: 'thinking_delta', thinking: 'thought' }
    })
    expect(getBuffers(store)['sess-1']).toBeUndefined()
  })

  it('ignores empty text_delta', () => {
    const store = makeStore()
    handleContentBlockDelta(makeCtx(store), {
      delta: { type: 'text_delta', text: '' }
    })
    expect(getBuffers(store)['sess-1']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// handleToolProgress
// ---------------------------------------------------------------------------

describe('handleToolProgress', () => {
  it('updates activity with tool name and elapsed time', () => {
    const store = makeStore()
    handleToolProgress(makeCtx(store), { tool_name: 'Bash', elapsed_time_seconds: 3.5 })
    expect(getSession(store).activity).toContain('Bash')
  })

  it('does nothing when session is waiting_input', () => {
    const store = makeStore({ status: 'waiting_input', activity: 'Waiting...' })
    handleToolProgress(makeCtx(store), { tool_name: 'Bash', elapsed_time_seconds: 1 })
    // Activity should remain unchanged
    expect(getSession(store).activity).toBe('Waiting...')
  })
})

// ---------------------------------------------------------------------------
// handleResult
// ---------------------------------------------------------------------------

describe('handleResult', () => {
  it('appends result message on success', () => {
    const store = makeStore()
    handleResult(makeCtx(store), {
      subtype: 'success', result: 'Final answer', usage: { input_tokens: 10, output_tokens: 5 }
    })
    const s = getSession(store)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].content).toBe('Final answer')
    expect(s.messages[0].role).toBe('assistant')
  })

  it('sets status to idle on success', () => {
    const store = makeStore()
    handleResult(makeCtx(store), { subtype: 'success', result: 'done' })
    expect(getSession(store).status).toBe('idle')
  })

  it('skips token accumulation when session is in sessionsWithStreamingTokens', () => {
    const store = makeStore()
    sessionsWithStreamingTokens.add('sess-1')
    handleResult(makeCtx(store), {
      subtype: 'success', result: 'done', usage: { input_tokens: 999, output_tokens: 999 }
    })
    // Tokens should not be added (streaming already counted them)
    expect(getSession(store).tokenUsage).toBeNull()
    // Session removed from set
    expect(sessionsWithStreamingTokens.has('sess-1')).toBe(false)
  })

  it('accumulates tokens when not in sessionsWithStreamingTokens', () => {
    const store = makeStore()
    handleResult(makeCtx(store), {
      subtype: 'success', result: 'done', usage: { input_tokens: 50, output_tokens: 25 }
    })
    const s = getSession(store)
    expect(s.tokenUsage?.input).toBe(50)
    expect(s.tokenUsage?.output).toBe(25)
  })

  it('de-duplicates result when it equals the last message content', () => {
    const lastMsg = { id: 'r-1', role: 'assistant' as const, content: 'same result', timestamp: Date.now() }
    const store = makeStore({ messages: [lastMsg] })
    handleResult(makeCtx(store), { subtype: 'success', result: 'same result' })
    expect(getSession(store).messages).toHaveLength(1)
  })

  it('appends error message on is_error', () => {
    const store = makeStore()
    handleResult(makeCtx(store), {
      is_error: true, errors: ['Permission denied', 'Timeout'], subtype: 'error'
    })
    const s = getSession(store)
    const last = s.messages[s.messages.length - 1]
    expect(last.role).toBe('system')
    expect(last.content).toContain('Permission denied')
    expect(last.content).toContain('Timeout')
    expect(s.status).toBe('error')
  })

  it('calls persistSession on success result', () => {
    const store = makeStore()
    handleResult(makeCtx(store), { subtype: 'success', result: 'output' })
    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })

  it('calls persistSession on error result', () => {
    const store = makeStore()
    handleResult(makeCtx(store), { is_error: true, errors: ['err'], subtype: 'error' })
    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })
})

// ---------------------------------------------------------------------------
// message_start — compact boundary patching
// ---------------------------------------------------------------------------

describe('handleStreamEvent (message_start) — compact boundary patching', () => {
  it('patches compact-boundary message with before->after when preCompactTokens exists', () => {
    const boundaryMsg = {
      id: 'msg-compact', role: 'system' as const, content: 'Conversation compacted',
      tag: 'compact-boundary', timestamp: Date.now()
    }
    const store = makeStore({ contextTokens: 180_000, messages: [boundaryMsg] })
    preCompactTokens.set('sess-1', 180_000)

    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 45_000, output_tokens: 0 } } }
    })

    const session = getSession(store)
    expect(session.contextTokens).toBe(45_000)
    expect(session.messages[0].content).toContain('180k')
    expect(session.messages[0].content).toContain('45k')
    expect(preCompactTokens.has('sess-1')).toBe(false)
  })

  it('does not patch messages when no preCompactTokens stash exists', () => {
    const regularMsg = {
      id: 'msg-1', role: 'assistant' as const, content: 'Hello',
      timestamp: Date.now()
    }
    const store = makeStore({ messages: [regularMsg] })

    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } }
    })

    expect(getSession(store).messages[0].content).toBe('Hello')
  })

  it('persists session after patching boundary message', () => {
    const boundaryMsg = {
      id: 'msg-compact', role: 'system' as const, content: 'Conversation compacted',
      tag: 'compact-boundary', timestamp: Date.now()
    }
    const store = makeStore({ messages: [boundaryMsg] })
    preCompactTokens.set('sess-1', 150_000)

    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 30_000, output_tokens: 0 } } }
    })

    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })

  it('only patches the last compact-boundary message', () => {
    const boundary1 = {
      id: 'compact-1', role: 'system' as const, content: 'Old boundary',
      tag: 'compact-boundary', timestamp: Date.now() - 5000
    }
    const regular = {
      id: 'msg-1', role: 'assistant' as const, content: 'Some response',
      timestamp: Date.now() - 3000
    }
    const boundary2 = {
      id: 'compact-2', role: 'system' as const, content: 'New boundary',
      tag: 'compact-boundary', timestamp: Date.now()
    }
    const store = makeStore({ messages: [boundary1, regular, boundary2] })
    preCompactTokens.set('sess-1', 100_000)

    handleStreamEvent(makeCtx(store), {
      event: { type: 'message_start', message: { usage: { input_tokens: 20_000, output_tokens: 0 } } }
    })

    const msgs = getSession(store).messages
    expect(msgs[0].content).toBe('Old boundary')
    expect(msgs[2].content).toContain('100k')
    expect(msgs[2].content).toContain('20k')
  })
})
