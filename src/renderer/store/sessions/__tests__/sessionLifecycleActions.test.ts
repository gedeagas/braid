import { describe, it, expect } from 'vitest'
import type { AgentSession } from '@/types'
import type { QueuedMessage } from '../storeTypes'
import { pickNextActiveSessionId, buildBulkDeletedState } from '../handlers/sessionLifecycleHelpers'

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeSession(id: string, worktreeId = 'wt-1'): AgentSession {
  return {
    id,
    worktreeId,
    name: 'Test Session',
    customName: false,
    status: 'idle',
    model: 'claude-sonnet-4-6',
    thinkingEnabled: true,
    extendedContext: false,
    effortLevel: 'high',
    planModeEnabled: false,
    messages: [],
    activity: null,
    runStartedAt: null,
    runCompletedAt: null,
    totalRunDurationMs: 0,
    tokenUsage: null, contextTokens: null,
    createdAt: Date.now()
  }
}

// ---------------------------------------------------------------------------
// pickNextActiveSessionId
// ---------------------------------------------------------------------------

describe('pickNextActiveSessionId', () => {
  // ── no order ──────────────────────────────────────────────────────────────

  it('returns null when order is undefined', () => {
    const sessions = { a: makeSession('a') }
    expect(pickNextActiveSessionId(sessions, 'a', undefined)).toBeNull()
  })

  it('returns null when order is empty', () => {
    const sessions = { a: makeSession('a') }
    expect(pickNextActiveSessionId(sessions, 'a', [])).toBeNull()
  })

  // ── id not in order ────────────────────────────────────────────────────────

  it('returns null when closedId is not found in order', () => {
    const sessions = { a: makeSession('a'), b: makeSession('b') }
    expect(pickNextActiveSessionId(sessions, 'z', ['a', 'b'])).toBeNull()
  })

  // ── prefer next (right) over previous (left) ──────────────────────────────

  it('prefers the session to the right when both exist', () => {
    const sessions = {
      a: makeSession('a'),
      b: makeSession('b'),
      c: makeSession('c')
    }
    // Closing 'b' → right candidate is 'c'
    expect(pickNextActiveSessionId(sessions, 'b', ['a', 'b', 'c'])).toBe('c')
  })

  it('falls back to left when no session exists to the right', () => {
    const sessions = { a: makeSession('a'), b: makeSession('b') }
    // Closing 'b' (last) → right is undefined, left is 'a'
    expect(pickNextActiveSessionId(sessions, 'b', ['a', 'b'])).toBe('a')
  })

  it('falls back to left when right session is already deleted from sessions map', () => {
    // 'c' removed from sessions (already deleted) but still in order list
    const sessions = { a: makeSession('a'), b: makeSession('b') }
    expect(pickNextActiveSessionId(sessions, 'b', ['a', 'b', 'c'])).toBe('a')
  })

  it('returns null when closing the only session', () => {
    const sessions = { a: makeSession('a') }
    expect(pickNextActiveSessionId(sessions, 'a', ['a'])).toBeNull()
  })

  it('does not return the closed id itself as next', () => {
    // Edge case: both candidates happen to be closedId (shouldn't happen, but guard it)
    const sessions = { a: makeSession('a') }
    const result = pickNextActiveSessionId(sessions, 'a', ['a', 'a'])
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildBulkDeletedState
// ---------------------------------------------------------------------------

describe('buildBulkDeletedState', () => {
  const sA = makeSession('a')
  const sB = makeSession('b')
  const sC = makeSession('c')

  function makeState() {
    return {
      sessions: { a: sA, b: sB, c: sC },
      queuedMessages: { a: { text: 'msg a' } as QueuedMessage, b: { text: 'msg b' } as QueuedMessage },
      draftInputs: { a: 'draft a', c: 'draft c' },
      draftSnippets: { b: [{ id: 'snip-1', content: 'x', firstLine: 'x', lineCount: 1, charCount: 1 }] },
      streamingTextBuffers: { a: 'streaming a', b: 'streaming b', c: 'streaming c' }
    }
  }

  it('removes deleted ids from all 5 maps', () => {
    const result = buildBulkDeletedState(makeState(), new Set(['a', 'b']))

    expect(Object.keys(result.sessions)).toEqual(['c'])
    expect(Object.keys(result.queuedMessages)).toEqual([])
    expect(Object.keys(result.draftInputs)).toEqual(['c'])
    expect(Object.keys(result.draftSnippets)).toEqual([])
    expect(Object.keys(result.streamingTextBuffers)).toEqual(['c'])
  })

  it('preserves entries not in delete set', () => {
    const result = buildBulkDeletedState(makeState(), new Set(['a']))

    expect(result.sessions).toEqual({ b: sB, c: sC })
    expect(result.queuedMessages).toEqual({ b: { text: 'msg b' } })
    expect(result.draftInputs).toEqual({ c: 'draft c' })
    expect(result.draftSnippets).toEqual({ b: [{ id: 'snip-1', content: 'x', firstLine: 'x', lineCount: 1, charCount: 1 }] })
    expect(result.streamingTextBuffers).toEqual({ b: 'streaming b', c: 'streaming c' })
  })

  it('returns all entries unchanged when delete set is empty', () => {
    const state = makeState()
    const result = buildBulkDeletedState(state, new Set())

    expect(result.sessions).toEqual(state.sessions)
    expect(result.queuedMessages).toEqual(state.queuedMessages)
    expect(result.draftInputs).toEqual(state.draftInputs)
    expect(result.draftSnippets).toEqual(state.draftSnippets)
    expect(result.streamingTextBuffers).toEqual(state.streamingTextBuffers)
  })

  it('returns all empty maps when delete set contains every id', () => {
    const result = buildBulkDeletedState(makeState(), new Set(['a', 'b', 'c']))

    expect(result.sessions).toEqual({})
    expect(result.queuedMessages).toEqual({})
    expect(result.draftInputs).toEqual({})
    expect(result.draftSnippets).toEqual({})
    expect(result.streamingTextBuffers).toEqual({})
  })

  it('does not mutate the input state', () => {
    const state = makeState()
    const sessionsCopy = { ...state.sessions }
    buildBulkDeletedState(state, new Set(['a', 'b']))
    expect(state.sessions).toEqual(sessionsCopy)
  })
})
