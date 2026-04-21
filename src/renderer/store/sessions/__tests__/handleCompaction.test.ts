import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import type { AgentSession } from '@/types'

vi.mock('../persistence', () => ({ persistSession: vi.fn(), bindSessionsStore: vi.fn() }))
// Return deterministic strings regardless of funny/boring ui setting
vi.mock('../activity', () => ({
  toolActivity: (name: string, phase: string) => `${name}:${phase}`,
  thinkingActivity: () => 'thinking',
  compactingActivity: () => 'compacting'
}))

import { handleSystemStatus, handleCompactBoundary, preCompactTokens } from '../handlers/handleCompaction'
import { persistSession } from '../persistence'
import type { HandlerContext } from '../handlers/types'

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-1', worktreeId: 'wt-1', name: 'My Session', customName: false,
    status: 'running', model: 'claude-sonnet-4-6', thinkingEnabled: false,
    extendedContext: false, effortLevel: 'high', planModeEnabled: false, messages: [], activity: null,
    runStartedAt: Date.now() - 2000, runCompletedAt: null, totalRunDurationMs: 0,
    tokenUsage: null, contextTokens: null, createdAt: Date.now(), ...overrides
  }
}

function makeStore(session: Partial<AgentSession> = {}) {
  return create<{ sessions: Record<string, AgentSession> }>()(() => ({
    sessions: { 'sess-1': makeSession(session) }
  })) as unknown as import('../stateUtils').Store
}

function makeCtx(store: import('../stateUtils').Store): HandlerContext {
  return { store, sessionId: 'sess-1' }
}

function getSession(store: import('../stateUtils').Store): AgentSession {
  return (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
}

beforeEach(() => {
  vi.mocked(persistSession).mockClear()
  preCompactTokens.clear()
})

// ---------------------------------------------------------------------------
// handleSystemStatus
// ---------------------------------------------------------------------------

describe('handleSystemStatus', () => {
  it('sets activity to compacting string when status is "compacting"', () => {
    const store = makeStore()
    handleSystemStatus(makeCtx(store), { status: 'compacting' })
    expect(getSession(store).activity).toBe('compacting')
  })

  it('does not change activity when status is null', () => {
    const store = makeStore({ activity: 'Speed-reading' })
    handleSystemStatus(makeCtx(store), { status: null })
    expect(getSession(store).activity).toBe('Speed-reading')
  })

  it('does not change activity for unknown status values', () => {
    const store = makeStore({ activity: 'Writing...' })
    handleSystemStatus(makeCtx(store), { status: 'unknown_future_status' })
    expect(getSession(store).activity).toBe('Writing...')
  })

  it('does not persist session', () => {
    const store = makeStore()
    handleSystemStatus(makeCtx(store), { status: 'compacting' })
    expect(persistSession).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handleCompactBoundary
// ---------------------------------------------------------------------------

describe('handleCompactBoundary', () => {
  it('appends a system message with compact-boundary tag', () => {
    const store = makeStore()
    handleCompactBoundary(makeCtx(store), {
      compact_metadata: { trigger: 'manual', pre_tokens: 150000 }
    })
    const s = getSession(store)
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].role).toBe('system')
    expect(s.messages[0].tag).toBe('compact-boundary')
  })

  it('persists session after appending boundary', () => {
    const store = makeStore()
    handleCompactBoundary(makeCtx(store), {
      compact_metadata: { trigger: 'manual' }
    })
    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })

  it('uses manual label when trigger is manual', () => {
    const store = makeStore()
    handleCompactBoundary(makeCtx(store), {
      compact_metadata: { trigger: 'manual' }
    })
    const msg = getSession(store).messages[0]
    expect(msg.content).toBe('Conversation compacted')
  })

  it('uses auto label with token count when trigger is auto', () => {
    const store = makeStore()
    handleCompactBoundary(makeCtx(store), {
      compact_metadata: { trigger: 'auto', pre_tokens: 180000 }
    })
    const msg = getSession(store).messages[0]
    expect(msg.content).toContain('180k')
  })

  it('falls back to manual label when metadata is missing', () => {
    const store = makeStore()
    handleCompactBoundary(makeCtx(store), {})
    const msg = getSession(store).messages[0]
    expect(msg.content).toBe('Conversation compacted')
  })

  it('appends boundary after existing messages', () => {
    const existing = {
      id: 'msg-1', role: 'assistant' as const, content: 'Hello',
      timestamp: Date.now()
    }
    const store = makeStore({ messages: [existing] })
    handleCompactBoundary(makeCtx(store), {
      compact_metadata: { trigger: 'manual' }
    })
    const s = getSession(store)
    expect(s.messages).toHaveLength(2)
    expect(s.messages[0].content).toBe('Hello')
    expect(s.messages[1].tag).toBe('compact-boundary')
  })

  it('stashes preCompactTokens when pre_tokens is present', () => {
    const store = makeStore()
    handleCompactBoundary(makeCtx(store), {
      compact_metadata: { trigger: 'auto', pre_tokens: 180000 }
    })
    expect(preCompactTokens.get('sess-1')).toBe(180000)
  })

  it('does not stash preCompactTokens when pre_tokens is absent', () => {
    const store = makeStore()
    handleCompactBoundary(makeCtx(store), {
      compact_metadata: { trigger: 'manual' }
    })
    expect(preCompactTokens.has('sess-1')).toBe(false)
  })
})
