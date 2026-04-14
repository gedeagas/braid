import { describe, it, expect, vi } from 'vitest'
import { create } from 'zustand'

// Mock persistence so persistSession is a no-op (avoids real IPC calls)
vi.mock('../persistence', () => ({ persistSession: vi.fn(), bindSessionsStore: vi.fn() }))

import { resolveEagerTitle, scheduleRefinedTitle } from '../handlers/titleManager'
import type { TitleManagerDeps } from '../handlers/types'
import type { AgentSession, Message } from '@/types'

// ---------------------------------------------------------------------------
// Minimal Zustand store factory for tests
// ---------------------------------------------------------------------------

interface MinimalState {
  sessions: Record<string, Partial<AgentSession>>
}

function makeStore(session: Partial<AgentSession> = {}) {
  const defaults: Partial<AgentSession> = {
    id: 'sess-1', name: 'New Chat', customName: false,
    worktreeId: 'wt-1', status: 'idle', messages: []
  }
  const store = create<MinimalState>()(() => ({
    sessions: { 'sess-1': { ...defaults, ...session } }
  }))
  // Cast to match Store interface used by the handler
  return store as unknown as import('../stateUtils').Store
}

// ---------------------------------------------------------------------------
// TitleManagerDeps factory
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<TitleManagerDeps> = {}): TitleManagerDeps {
  return {
    getPendingTitle: vi.fn().mockReturnValue(undefined),
    deletePendingTitle: vi.fn(),
    generateRefinedTitle: vi.fn().mockResolvedValue('Generated Title'),
    syncSessionName: vi.fn(),
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// resolveEagerTitle
// ---------------------------------------------------------------------------

describe('resolveEagerTitle', () => {
  it('does nothing when no pending title exists', async () => {
    const store = makeStore()
    const deps = makeDeps({ getPendingTitle: vi.fn().mockReturnValue(undefined) })
    await resolveEagerTitle('sess-1', store, deps)
    expect(deps.deletePendingTitle).not.toHaveBeenCalled()
    expect(deps.syncSessionName).not.toHaveBeenCalled()
  })

  it('deletes pending title when session has customName', async () => {
    const store = makeStore({ customName: true })
    const pendingPromise = Promise.resolve('Some Title')
    const deps = makeDeps({ getPendingTitle: vi.fn().mockReturnValue(pendingPromise) })
    await resolveEagerTitle('sess-1', store, deps)
    expect(deps.deletePendingTitle).toHaveBeenCalledWith('sess-1')
    expect(deps.syncSessionName).not.toHaveBeenCalled()
  })

  it('does nothing when pending title resolves to empty string', async () => {
    const store = makeStore()
    const deps = makeDeps({ getPendingTitle: vi.fn().mockReturnValue(Promise.resolve('')) })
    await resolveEagerTitle('sess-1', store, deps)
    expect(deps.syncSessionName).not.toHaveBeenCalled()
  })

  it('does nothing when resolved title equals current name', async () => {
    const store = makeStore({ name: 'Same Title' })
    const deps = makeDeps({ getPendingTitle: vi.fn().mockReturnValue(Promise.resolve('Same Title')) })
    await resolveEagerTitle('sess-1', store, deps)
    expect(deps.syncSessionName).not.toHaveBeenCalled()
  })

  it('updates session name and syncs when title changes', async () => {
    const store = makeStore({ name: 'New Chat' })
    const deps = makeDeps({ getPendingTitle: vi.fn().mockReturnValue(Promise.resolve('Better Title')) })
    await resolveEagerTitle('sess-1', store, deps)
    // Check store was updated
    expect((store.getState().sessions['sess-1'] as AgentSession).name).toBe('Better Title')
    expect(deps.syncSessionName).toHaveBeenCalledWith('sess-1', 'Better Title')
  })

  it('swallows errors from the pending promise', async () => {
    const store = makeStore()
    const deps = makeDeps({
      getPendingTitle: vi.fn().mockReturnValue(Promise.reject(new Error('API error')))
    })
    // Should not throw
    await expect(resolveEagerTitle('sess-1', store, deps)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// scheduleRefinedTitle
// ---------------------------------------------------------------------------

describe('scheduleRefinedTitle', () => {
  function makeMessage(role: 'user' | 'assistant', content: string): Message {
    return { id: `msg-${Math.random()}`, role, content, timestamp: Date.now() }
  }

  it('does nothing when session has customName', async () => {
    const store = makeStore({ customName: true })
    const deps = makeDeps()
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'world')]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 10))
    expect(deps.generateRefinedTitle).not.toHaveBeenCalled()
  })

  it('does nothing when there are no messages', async () => {
    const store = makeStore()
    const deps = makeDeps()
    scheduleRefinedTitle('sess-1', [], store, deps)
    await new Promise((r) => setTimeout(r, 10))
    expect(deps.generateRefinedTitle).not.toHaveBeenCalled()
  })

  it('does nothing when there is no user message', async () => {
    const store = makeStore()
    const deps = makeDeps()
    const messages = [makeMessage('assistant', 'Hello')]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 10))
    expect(deps.generateRefinedTitle).not.toHaveBeenCalled()
  })

  it('does nothing when there is no assistant message', async () => {
    const store = makeStore()
    const deps = makeDeps()
    const messages = [makeMessage('user', 'Hello')]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 10))
    expect(deps.generateRefinedTitle).not.toHaveBeenCalled()
  })

  it('calls generateRefinedTitle with truncated user + assistant content', async () => {
    const store = makeStore()
    const deps = makeDeps()
    const messages = [
      makeMessage('user', 'Fix the bug in auth'),
      makeMessage('assistant', 'I will fix that')
    ]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 10))
    expect(deps.generateRefinedTitle).toHaveBeenCalledWith(
      'Fix the bug in auth',
      'I will fix that',
      undefined // 'New Chat' becomes undefined
    )
  })

  it('passes current title (not "New Chat") to generateRefinedTitle', async () => {
    const store = makeStore({ name: 'Fix auth bug' })
    const deps = makeDeps()
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'world')]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 10))
    expect(deps.generateRefinedTitle).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'Fix auth bug'
    )
  })

  it('updates session name when refinement returns a different title', async () => {
    const store = makeStore({ name: 'New Chat' })
    const deps = makeDeps({ generateRefinedTitle: vi.fn().mockResolvedValue('Refined Title') })
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'world')]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 50))
    expect((store.getState().sessions['sess-1'] as AgentSession).name).toBe('Refined Title')
    expect(deps.syncSessionName).toHaveBeenCalledWith('sess-1', 'Refined Title')
  })

  it('does not update when refinement returns the same title', async () => {
    const store = makeStore({ name: 'Same Title' })
    const deps = makeDeps({ generateRefinedTitle: vi.fn().mockResolvedValue('Same Title') })
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'world')]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 50))
    expect(deps.syncSessionName).not.toHaveBeenCalled()
  })

  it('swallows errors from generateRefinedTitle', async () => {
    const store = makeStore()
    const deps = makeDeps({
      generateRefinedTitle: vi.fn().mockRejectedValue(new Error('API error'))
    })
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'world')]
    // Should not throw
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 50))
  })

  it('does not sync if customName is set between schedule and resolve (race condition)', async () => {
    const store = makeStore({ name: 'New Chat', customName: false })
    // Simulate: title arrives, but user renamed the session before promise resolved
    const deps = makeDeps({
      generateRefinedTitle: vi.fn().mockImplementation(async () => {
        // Mark session as custom-named via proper Zustand setState
        store.setState((s: { sessions: Record<string, AgentSession> }) => ({
          sessions: { ...s.sessions, 'sess-1': { ...s.sessions['sess-1'], customName: true } }
        }))
        return 'AI-Generated Title'
      })
    })
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'world')]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 50))
    // customName was set to true before resolve — sync must not fire
    expect(deps.syncSessionName).not.toHaveBeenCalled()
  })

  it('returns empty string from generateRefinedTitle without updating', async () => {
    const store = makeStore({ name: 'Current' })
    const deps = makeDeps({ generateRefinedTitle: vi.fn().mockResolvedValue('') })
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'world')]
    scheduleRefinedTitle('sess-1', messages, store, deps)
    await new Promise((r) => setTimeout(r, 50))
    expect(deps.syncSessionName).not.toHaveBeenCalled()
  })
})
