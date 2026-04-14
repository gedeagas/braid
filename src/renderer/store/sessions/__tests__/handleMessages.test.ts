import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import type { AgentSession, Message, ToolCall, ContentBlock } from '@/types'

vi.mock('../persistence', () => ({ persistSession: vi.fn(), bindSessionsStore: vi.fn() }))
vi.mock('../handlers/worktreeSync', () => ({
  triggerWorktreeRefreshIfNeeded: vi.fn(),
  createWorktreeSyncDeps: vi.fn(() => ({}))
}))

import { handleUser, handleAssistant } from '../handlers/handleMessages'
import { persistSession } from '../persistence'
import { triggerWorktreeRefreshIfNeeded } from '../handlers/worktreeSync'
import type { HandlerContext } from '../handlers/types'

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-1', worktreeId: 'wt-1', name: 'My Session', customName: false,
    status: 'running', model: 'claude-sonnet-4-6', thinkingEnabled: false,
    planModeEnabled: false, messages: [], activity: null,
    runStartedAt: null, runCompletedAt: null, totalRunDurationMs: 0,
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

// ---------------------------------------------------------------------------
// handleUser — tool result patching
// ---------------------------------------------------------------------------

describe('handleUser', () => {
  beforeEach(() => {
    vi.mocked(persistSession).mockClear()
    vi.mocked(triggerWorktreeRefreshIfNeeded).mockClear()
  })

  function makeAssistantMsg(toolCalls: ToolCall[]): Message {
    const blocks: ContentBlock[] = toolCalls.map((tc) => ({ type: 'tool_use', toolCall: tc }))
    return { id: 'msg-a', role: 'assistant', content: '', toolCalls, blocks, timestamp: Date.now() }
  }

  function makeUserEvent(patches: Array<{ toolUseId: string; content: string; isError?: boolean }>) {
    return {
      message: {
        content: patches.map((p) => ({
          type: 'tool_result',
          tool_use_id: p.toolUseId,
          content: p.content,
          is_error: p.isError ?? false
        }))
      }
    }
  }

  it('ignores event when message is missing', () => {
    const store = makeStore()
    handleUser(makeCtx(store), {})
    expect(persistSession).not.toHaveBeenCalled()
  })

  it('ignores event when content is not an array', () => {
    const store = makeStore()
    handleUser(makeCtx(store), { message: { content: 'text' } })
    expect(persistSession).not.toHaveBeenCalled()
  })

  it('patches result onto matching tool call by toolUseId', () => {
    const tc: ToolCall = { id: 'tc-1', name: 'Bash', input: '{"command":"ls"}' }
    const store = makeStore({ messages: [makeAssistantMsg([tc])] })
    handleUser(makeCtx(store), makeUserEvent([{ toolUseId: 'tc-1', content: 'file1.ts\nfile2.ts' }]))
    const s = getSession(store)
    expect(s.messages[0].toolCalls?.[0].result).toBe('file1.ts\nfile2.ts')
  })

  it('patches error onto matching tool call when is_error is true', () => {
    const tc: ToolCall = { id: 'tc-2', name: 'Bash', input: '{"command":"rm /sys"}' }
    const store = makeStore({ messages: [makeAssistantMsg([tc])] })
    handleUser(makeCtx(store), makeUserEvent([{ toolUseId: 'tc-2', content: 'Permission denied', isError: true }]))
    const s = getSession(store)
    expect(s.messages[0].toolCalls?.[0].error).toBe('Permission denied')
    expect(s.messages[0].toolCalls?.[0].result).toBeUndefined()
  })

  it('sets completedAt timestamp on patched tool call', () => {
    const before = Date.now()
    const tc: ToolCall = { id: 'tc-3', name: 'Read', input: '{"file_path":"/foo"}' }
    const store = makeStore({ messages: [makeAssistantMsg([tc])] })
    handleUser(makeCtx(store), makeUserEvent([{ toolUseId: 'tc-3', content: 'content' }]))
    const s = getSession(store)
    expect(s.messages[0].toolCalls?.[0].completedAt).toBeGreaterThanOrEqual(before)
  })

  it('updates both toolCalls[] and blocks[] on the message', () => {
    const tc: ToolCall = { id: 'tc-4', name: 'Read', input: '{}' }
    const store = makeStore({ messages: [makeAssistantMsg([tc])] })
    handleUser(makeCtx(store), makeUserEvent([{ toolUseId: 'tc-4', content: 'data' }]))
    const s = getSession(store)
    // toolCalls patched
    expect(s.messages[0].toolCalls?.[0].result).toBe('data')
    // blocks patched too
    const toolBlock = s.messages[0].blocks?.find((b) => b.type === 'tool_use')
    expect(toolBlock?.type === 'tool_use' && toolBlock.toolCall.result).toBe('data')
  })

  it('calls triggerWorktreeRefreshIfNeeded', () => {
    const tc: ToolCall = { id: 'tc-5', name: 'Bash', input: '{"command":"git push"}' }
    const store = makeStore({ messages: [makeAssistantMsg([tc])] })
    handleUser(makeCtx(store), makeUserEvent([{ toolUseId: 'tc-5', content: 'ok' }]))
    expect(triggerWorktreeRefreshIfNeeded).toHaveBeenCalled()
  })

  it('calls persistSession after patching', () => {
    const tc: ToolCall = { id: 'tc-6', name: 'Bash', input: '{}' }
    const store = makeStore({ messages: [makeAssistantMsg([tc])] })
    handleUser(makeCtx(store), makeUserEvent([{ toolUseId: 'tc-6', content: 'done' }]))
    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })
})

// ---------------------------------------------------------------------------
// handleAssistant — message completion
// ---------------------------------------------------------------------------

describe('handleAssistant', () => {
  beforeEach(() => vi.mocked(persistSession).mockClear())

  const textMsg = {
    message: { content: [{ type: 'text', text: 'Here is the result' }] }
  }

  it('appends new assistant message when no partial exists', () => {
    const store = makeStore()
    handleAssistant(makeCtx(store), textMsg)
    const s = getSession(store)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].role).toBe('assistant')
    expect(s.messages[0].content).toBe('Here is the result')
    expect(s.messages[0].isPartial).toBe(false)
  })

  it('merges into existing partial message', () => {
    const partial: Message = {
      id: 'partial-1', role: 'assistant', content: '', isPartial: true, timestamp: Date.now()
    }
    const store = makeStore({ messages: [partial] })
    handleAssistant(makeCtx(store), textMsg)
    const s = getSession(store)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].content).toBe('Here is the result')
    expect(s.messages[0].isPartial).toBe(false)
  })

  it('extracts tool calls from content blocks', () => {
    const event = {
      message: {
        content: [
          { type: 'tool_use', id: 'tc-1', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    }
    const store = makeStore()
    handleAssistant(makeCtx(store), event)
    const s = getSession(store)
    expect(s.messages[0].toolCalls).toHaveLength(1)
    expect(s.messages[0].toolCalls?.[0].name).toBe('Bash')
  })

  it('detects AskUserQuestion and sets pendingQuestion', () => {
    const questions = [{ question: 'Q?', header: 'H', options: [{ label: 'A', description: 'opt A' }], multiSelect: false }]
    const event = {
      message: {
        content: [
          { type: 'tool_use', id: 'tc-ask', name: 'AskUserQuestion', input: { questions } }
        ]
      }
    }
    const store = makeStore()
    handleAssistant(makeCtx(store), event)
    const s = getSession(store)
    expect(s.status).toBe('waiting_input')
    expect(s.pendingQuestion).toBeDefined()
    expect(s.pendingQuestion?.toolUseId).toBe('tc-ask')
  })

  it('detects ExitPlanMode and sets pendingPlanApproval', () => {
    const event = {
      message: {
        content: [
          { type: 'tool_use', id: 'tc-plan', name: 'ExitPlanMode', input: {} }
        ]
      }
    }
    const store = makeStore()
    handleAssistant(makeCtx(store), event)
    const s = getSession(store)
    expect(s.status).toBe('waiting_input')
    expect(s.pendingPlanApproval).toBeDefined()
    expect(s.pendingPlanApproval?.toolUseId).toBe('tc-plan')
  })

  it('calls persistSession', () => {
    const store = makeStore()
    handleAssistant(makeCtx(store), textMsg)
    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })
})
