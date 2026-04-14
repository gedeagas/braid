import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import type { AgentSession, SlashCommand } from '@/types'

vi.mock('../persistence', () => ({ persistSession: vi.fn(), bindSessionsStore: vi.fn() }))

import { handleInit, handleSlashCommands, handleSystemInit } from '../handlers/handleLifecycle'
import { persistSession } from '../persistence'
import type { HandlerContext } from '../handlers/types'

// Clear mock call counts before every test (shared across all describe blocks)
beforeEach(() => vi.mocked(persistSession).mockClear())

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function makeStore(session: Partial<AgentSession> = {}) {
  const defaults: AgentSession = {
    id: 'sess-1', worktreeId: 'wt-1', name: 'New Chat', customName: false,
    status: 'idle', model: 'claude-sonnet-4-6', thinkingEnabled: false,
    planModeEnabled: false, messages: [], activity: null,
    runStartedAt: null, runCompletedAt: null, totalRunDurationMs: 0,
    tokenUsage: null, contextTokens: null, createdAt: Date.now()
  }
  return create<{ sessions: Record<string, AgentSession>; queuedMessages: Record<string, unknown>; streamingTextBuffers: Record<string, string>; sendMessage: () => void }>()(() => ({
    sessions: { 'sess-1': { ...defaults, ...session } },
    queuedMessages: {},
    streamingTextBuffers: {},
    sendMessage: vi.fn()
  })) as unknown as import('../stateUtils').Store
}

function makeCtx(store: import('../stateUtils').Store): HandlerContext {
  return { store, sessionId: 'sess-1' }
}

// ---------------------------------------------------------------------------
// handleInit
// ---------------------------------------------------------------------------

describe('handleInit', () => {
  it('sets sdkSessionId from event', () => {
    const store = makeStore()
    handleInit(makeCtx(store), { sdkSessionId: 'sdk-abc', slashCommands: [] })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.sdkSessionId).toBe('sdk-abc')
  })

  it('seeds slashCommands with name-only metadata', () => {
    const store = makeStore()
    handleInit(makeCtx(store), {
      sdkSessionId: 'sdk-abc',
      slashCommands: [{ name: 'commit', source: 'builtin' }]
    })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.slashCommands).toEqual([
      { name: 'commit', description: '', argumentHint: undefined, source: 'builtin' }
    ])
  })

  it('defaults command source to builtin when missing', () => {
    const store = makeStore()
    handleInit(makeCtx(store), { sdkSessionId: 'sdk-abc', slashCommands: [{ name: 'test' }] })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.slashCommands?.[0].source).toBe('builtin')
  })

  it('calls persistSession after updating', () => {
    const store = makeStore()
    handleInit(makeCtx(store), { sdkSessionId: 'sdk-abc', slashCommands: [] })
    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })

  it('does nothing when session does not exist', () => {
    const store = makeStore()
    const ctx: HandlerContext = { store, sessionId: 'nonexistent' }
    handleInit(ctx, { sdkSessionId: 'sdk-abc', slashCommands: [] })
    expect(persistSession).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handleSlashCommands
// ---------------------------------------------------------------------------

describe('handleSlashCommands', () => {
  it('replaces slashCommands with rich metadata', () => {
    const store = makeStore()
    handleSlashCommands(makeCtx(store), {
      commands: [
        { name: 'commit', description: 'Create a commit', argumentHint: '-m <msg>', source: 'builtin' }
      ]
    })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.slashCommands).toEqual([
      { name: 'commit', description: 'Create a commit', argumentHint: '-m <msg>', source: 'builtin' }
    ])
  })

  it('handles empty commands array', () => {
    const store = makeStore()
    handleSlashCommands(makeCtx(store), { commands: [] })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.slashCommands).toEqual([])
  })

  it('does not call persistSession', () => {
    const store = makeStore()
    handleSlashCommands(makeCtx(store), { commands: [] })
    expect(persistSession).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handleSystemInit
// ---------------------------------------------------------------------------

describe('handleSystemInit', () => {
  it('merges builtins and skills into slashCommands', () => {
    const store = makeStore()
    handleSystemInit(makeCtx(store), {
      session_id: 'sdk-legacy',
      slash_commands: ['commit', 'review'],
      skills: ['deploy']
    })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    const commands = s.slashCommands as SlashCommand[]
    expect(commands).toHaveLength(3)
    expect(commands.filter((c) => c.source === 'builtin').map((c) => c.name)).toEqual(['commit', 'review'])
    expect(commands.filter((c) => c.source === 'skill').map((c) => c.name)).toEqual(['deploy'])
  })

  it('sets sdkSessionId from session_id field', () => {
    const store = makeStore()
    handleSystemInit(makeCtx(store), { session_id: 'legacy-id', slash_commands: [], skills: [] })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.sdkSessionId).toBe('legacy-id')
  })

  it('handles empty slash_commands and skills gracefully', () => {
    const store = makeStore()
    handleSystemInit(makeCtx(store), { session_id: 'x', slash_commands: [], skills: [] })
    const s = (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
    expect(s.slashCommands).toEqual([])
  })
})
