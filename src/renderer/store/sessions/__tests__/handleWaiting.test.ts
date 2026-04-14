import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import type { AgentSession, Message, ToolCall } from '@/types'

vi.mock('../persistence', () => ({ persistSession: vi.fn(), bindSessionsStore: vi.fn() }))
vi.mock('../handlers/notifications', () => ({
  maybeShowToast: vi.fn(),
  createNotificationDeps: vi.fn(() => ({}))
}))

import { handleWaitingInput, handleError } from '../handlers/handleWaiting'
import { persistSession } from '../persistence'
import { maybeShowToast } from '../handlers/notifications'
import type { HandlerContext } from '../handlers/types'

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-1', worktreeId: 'wt-1', name: 'My Session', customName: false,
    status: 'running', model: 'claude-sonnet-4-6', thinkingEnabled: false,
    planModeEnabled: false, messages: [], activity: 'Running Bash...',
    runStartedAt: Date.now() - 5000, runCompletedAt: null, totalRunDurationMs: 0,
    tokenUsage: null, contextTokens: null, createdAt: Date.now(), ...overrides
  }
}

function makeMessageWithTool(toolName: string, toolInput: string): Message {
  const tc: ToolCall = { id: 'tc-1', name: toolName, input: toolInput }
  return { id: 'msg-1', role: 'assistant', content: '', toolCalls: [tc], timestamp: Date.now() }
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

// ---------------------------------------------------------------------------
// handleWaitingInput — tool_permission path
// ---------------------------------------------------------------------------

describe('handleWaitingInput (reason: tool_permission)', () => {
  beforeEach(() => {
    vi.mocked(persistSession).mockClear()
    vi.mocked(maybeShowToast).mockClear()
  })

  const toolPermEvent = {
    reason: 'tool_permission',
    toolUseId: 'tc-perm-1',
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /tmp/foo' },
    displayName: 'Bash',
    description: 'Run shell commands'
  }

  it('sets status to waiting_input', () => {
    const store = makeStore()
    handleWaitingInput(makeCtx(store), toolPermEvent)
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.status).toBe('waiting_input')
  })

  it('sets activity to permission waiting message', () => {
    const store = makeStore()
    handleWaitingInput(makeCtx(store), toolPermEvent)
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.activity).toBe('Waiting for permission...')
  })

  it('sets pendingToolPermission from event fields', () => {
    const store = makeStore()
    handleWaitingInput(makeCtx(store), toolPermEvent)
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.pendingToolPermission).toEqual({
      toolUseId: 'tc-perm-1',
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /tmp/foo' },
      displayName: 'Bash',
      description: 'Run shell commands'
    })
  })

  it('calls persistSession', () => {
    const store = makeStore()
    handleWaitingInput(makeCtx(store), toolPermEvent)
    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })

  it('calls maybeShowToast with waiting_input type', () => {
    const store = makeStore()
    handleWaitingInput(makeCtx(store), toolPermEvent)
    expect(maybeShowToast).toHaveBeenCalledWith('sess-1', 'waiting_input', expect.anything())
  })
})

// ---------------------------------------------------------------------------
// handleWaitingInput — question/plan_approval path
// ---------------------------------------------------------------------------

describe('handleWaitingInput (question/plan_approval)', () => {
  beforeEach(() => {
    vi.mocked(persistSession).mockClear()
    vi.mocked(maybeShowToast).mockClear()
  })

  it('sets status to waiting_input', () => {
    const msg = makeMessageWithTool('AskUserQuestion', JSON.stringify({
      questions: [{ question: 'Which approach?', header: 'Approach', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }]
    }))
    const store = makeStore({ messages: [msg] })
    handleWaitingInput(makeCtx(store), { reason: 'question' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.status).toBe('waiting_input')
  })

  it('sets pendingQuestion when AskUserQuestion tool call is present', () => {
    const questions = [{ question: 'Q?', header: 'H', options: [{ label: 'Yes', description: 'yes' }], multiSelect: false }]
    const msg = makeMessageWithTool('AskUserQuestion', JSON.stringify({ questions }))
    const store = makeStore({ messages: [msg] })
    handleWaitingInput(makeCtx(store), { reason: 'question' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.pendingQuestion).toBeDefined()
    expect(s.pendingQuestion?.toolUseId).toBe('tc-1')
  })

  it('is idempotent when status is already waiting_input', () => {
    const store = makeStore({ status: 'waiting_input' })
    handleWaitingInput(makeCtx(store), { reason: 'question' })
    // persistSession should not be called (early return)
    expect(persistSession).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handleError
// ---------------------------------------------------------------------------

describe('handleError', () => {
  beforeEach(() => {
    vi.mocked(persistSession).mockClear()
    vi.mocked(maybeShowToast).mockClear()
  })

  it('sets status to error', () => {
    const store = makeStore()
    handleError(makeCtx(store), { message: 'Something went wrong' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.status).toBe('error')
  })

  it('clears activity', () => {
    const store = makeStore()
    handleError(makeCtx(store), { message: 'err' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.activity).toBeNull()
  })

  it('appends a system message with the error text', () => {
    const store = makeStore()
    handleError(makeCtx(store), { message: 'Network timeout' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    const last = s.messages[s.messages.length - 1]
    expect(last.role).toBe('system')
    expect(last.content).toContain('Network timeout')
  })

  it('seals any partial messages before appending error', () => {
    const partialMsg: Message = { id: 'p-1', role: 'assistant', content: 'partial', isPartial: true, timestamp: Date.now() }
    const store = makeStore({ messages: [partialMsg] })
    handleError(makeCtx(store), { message: 'err' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.messages[0].isPartial).toBe(false)
  })

  it('clears runStartedAt and accumulates duration', () => {
    const runStartedAt = Date.now() - 3000
    const store = makeStore({ runStartedAt, totalRunDurationMs: 1000 })
    handleError(makeCtx(store), { message: 'err' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.runStartedAt).toBeNull()
    expect(s.totalRunDurationMs).toBeGreaterThan(1000)
  })

  it('calls persistSession and maybeShowToast', () => {
    const store = makeStore()
    handleError(makeCtx(store), { message: 'err' })
    expect(persistSession).toHaveBeenCalledWith('sess-1')
    expect(maybeShowToast).toHaveBeenCalledWith('sess-1', 'error', expect.anything())
  })
})

// ---------------------------------------------------------------------------
// handleError — auth error path
// ---------------------------------------------------------------------------

describe('handleError (auth)', () => {
  beforeEach(() => {
    vi.mocked(persistSession).mockClear()
    vi.mocked(maybeShowToast).mockClear()
  })

  const authEvent = {
    message: 'OAuth token has expired',
    errorKind: 'auth',
    authType: 'oauth'
  }

  it('sets pendingAuthError for auth errors', () => {
    const store = makeStore()
    handleError(makeCtx(store), authEvent)
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.pendingAuthError).toEqual({
      message: 'OAuth token has expired',
      authType: 'oauth'
    })
  })

  it('does NOT append a system message for auth errors', () => {
    const store = makeStore()
    handleError(makeCtx(store), authEvent)
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.messages).toHaveLength(0)
  })

  it('sets status to error', () => {
    const store = makeStore()
    handleError(makeCtx(store), authEvent)
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.status).toBe('error')
  })

  it('defaults authType to unknown when not provided', () => {
    const store = makeStore()
    handleError(makeCtx(store), { message: 'auth failed', errorKind: 'auth' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.pendingAuthError?.authType).toBe('unknown')
  })

  it('preserves api_key authType', () => {
    const store = makeStore()
    handleError(makeCtx(store), { message: 'invalid api key', errorKind: 'auth', authType: 'api_key' })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.pendingAuthError?.authType).toBe('api_key')
  })

  it('calls persistSession and maybeShowToast for auth errors', () => {
    const store = makeStore()
    handleError(makeCtx(store), authEvent)
    expect(persistSession).toHaveBeenCalledWith('sess-1')
    expect(maybeShowToast).toHaveBeenCalledWith('sess-1', 'error', expect.anything())
  })
})
