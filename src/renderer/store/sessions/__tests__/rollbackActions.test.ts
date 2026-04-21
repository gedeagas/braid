import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import type { AgentSession, Message } from '@/types'

// ---------------------------------------------------------------------------
// Mocks — must come before imports
// ---------------------------------------------------------------------------

vi.mock('../persistence', () => ({ persistSession: vi.fn(), bindSessionsStore: vi.fn() }))
vi.mock('../storage', () => ({
  sessionWorktreePaths: new Map([['sess-1', '/repo']]),
  sessionLinkedPaths: new Map(),
  pendingTitleGenerations: new Map()
}))
vi.mock('@/lib/ipc', () => ({
  git: {
    restoreSnapshot: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue([])
  }
}))
vi.mock('@/store/ui', () => ({
  useUIStore: {
    getState: () => ({
      setChangesCount: vi.fn(),
      bumpDiffRevision: vi.fn()
    })
  }
}))

// Mock the sessions store module so rollbackActions can import it. We replace
// useSessionsStore with a ref that we patch per-test to point at the test store.
const storeRef = { current: null as unknown }
vi.mock('../store', () => ({
  useSessionsStore: new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      const s = storeRef.current as Record<string, unknown>
      return s?.[prop]
    }
  })
}))

import { persistSession } from '../persistence'
import { sessionWorktreePaths } from '../storage'
import * as ipc from '@/lib/ipc'
import { createRollbackActions } from '../handlers/rollbackActions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    role: 'user',
    content: 'hello',
    timestamp: Date.now(),
    ...overrides
  }
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-1', worktreeId: 'wt-1', name: 'Test', customName: false,
    status: 'idle', model: 'claude-sonnet-4-6', thinkingEnabled: false,
    extendedContext: false, effortLevel: 'high', planModeEnabled: false,
    messages: [], activity: null,
    runStartedAt: null, runCompletedAt: null, totalRunDurationMs: 0,
    tokenUsage: null, contextTokens: null, createdAt: Date.now(),
    ...overrides
  }
}

// Wire up the slice factory to a real Zustand store
function createActions(session: Partial<AgentSession> = {}) {
  const store = create<{ sessions: Record<string, AgentSession> }>()(() => ({
    sessions: { 'sess-1': makeSession(session) }
  }))

  // Point the proxy at our test store so updateSession(useSessionsStore, ...) works
  storeRef.current = store

  const actions = createRollbackActions(
    store.setState.bind(store) as never,
    store.getState.bind(store) as never,
    {} as never
  )

  const getSession = () =>
    (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']

  return { actions, store, getSession }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ipc.git.restoreSnapshot).mockResolvedValue(undefined)
  vi.mocked(ipc.git.getStatus).mockResolvedValue([])
})

describe('rollbackToUserMessage', () => {
  describe('safety guards', () => {
    it('refuses when session does not exist', async () => {
      const { actions } = createActions()
      // Call with a non-existent session ID
      await actions.rollbackToUserMessage('nonexistent', 'msg-1')
      expect(ipc.git.restoreSnapshot).not.toHaveBeenCalled()
    })

    it('refuses when session is running', async () => {
      const userMsg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'abc123' })
      const { actions } = createActions({ status: 'running', messages: [userMsg] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(ipc.git.restoreSnapshot).not.toHaveBeenCalled()
    })

    it('refuses when session is waiting_input', async () => {
      const userMsg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'abc123' })
      const { actions } = createActions({ status: 'waiting_input' as AgentSession['status'], messages: [userMsg] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(ipc.git.restoreSnapshot).not.toHaveBeenCalled()
    })

    it('refuses when target message is not found', async () => {
      const { actions } = createActions({ messages: [makeMsg({ id: 'msg-1' })] })
      await actions.rollbackToUserMessage('sess-1', 'msg-nonexistent')
      expect(ipc.git.restoreSnapshot).not.toHaveBeenCalled()
    })

    it('refuses when target is an assistant message', async () => {
      const assistantMsg = makeMsg({ id: 'msg-1', role: 'assistant', content: 'hi', snapshotSha: 'abc' })
      const { actions } = createActions({ messages: [assistantMsg] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(ipc.git.restoreSnapshot).not.toHaveBeenCalled()
    })

    it('refuses when target has no snapshotSha', async () => {
      const userMsg = makeMsg({ id: 'msg-1', role: 'user' })
      const { actions } = createActions({ messages: [userMsg] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(ipc.git.restoreSnapshot).not.toHaveBeenCalled()
    })

    it('refuses when worktree path is unknown', async () => {
      const userMsg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'abc123' })
      // Clear the worktree path mapping
      sessionWorktreePaths.clear()
      const { actions } = createActions({ messages: [userMsg] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(ipc.git.restoreSnapshot).not.toHaveBeenCalled()
      // Restore for other tests
      sessionWorktreePaths.set('sess-1', '/repo')
    })
  })

  describe('allows rollback from idle, error, and inactive states', () => {
    for (const status of ['idle', 'error', 'inactive'] as const) {
      it(`allows rollback when session is ${status}`, async () => {
        const userMsg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'abc123' })
        const { actions } = createActions({ status, messages: [userMsg] })
        await actions.rollbackToUserMessage('sess-1', 'msg-1')
        expect(ipc.git.restoreSnapshot).toHaveBeenCalledWith('/repo', 'abc123')
      })
    }
  })

  describe('snapshot restore', () => {
    it('calls restoreSnapshot with correct worktree path and SHA', async () => {
      const userMsg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'deadbeef' })
      const { actions } = createActions({ messages: [userMsg] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(ipc.git.restoreSnapshot).toHaveBeenCalledWith('/repo', 'deadbeef')
    })

    it('refreshes the Changes tab after restore', async () => {
      const userMsg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'abc123' })
      const { actions } = createActions({ messages: [userMsg] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(ipc.git.getStatus).toHaveBeenCalledWith('/repo')
    })
  })

  describe('message truncation', () => {
    it('truncates messages up to (not including) the target', async () => {
      const msg1 = makeMsg({ id: 'msg-1', role: 'user', content: 'first', snapshotSha: 'snap1' })
      const msg2 = makeMsg({ id: 'msg-2', role: 'assistant', content: 'reply' })
      const msg3 = makeMsg({ id: 'msg-3', role: 'user', content: 'second', snapshotSha: 'snap2' })
      const msg4 = makeMsg({ id: 'msg-4', role: 'assistant', content: 'reply2' })

      const { actions, getSession: get } = createActions({ messages: [msg1, msg2, msg3, msg4] })
      await actions.rollbackToUserMessage('sess-1', 'msg-3')
      // msg-3 and msg-4 should be gone, msg-1 and msg-2 remain
      expect(get().messages).toHaveLength(2)
      expect(get().messages[0].id).toBe('msg-1')
      expect(get().messages[1].id).toBe('msg-2')
    })

    it('removes all messages when rolling back to the first user message', async () => {
      const msg1 = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'snap1' })
      const msg2 = makeMsg({ id: 'msg-2', role: 'assistant', content: 'reply' })

      const { actions, getSession: get } = createActions({ messages: [msg1, msg2] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(get().messages).toHaveLength(0)
    })
  })

  describe('pendingResumeAt', () => {
    it('sets pendingResumeAt to the preceding assistant sdkUuid', async () => {
      const msg1 = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'snap1' })
      const msg2 = makeMsg({ id: 'msg-2', role: 'assistant', content: 'reply', sdkUuid: 'sdk-uuid-42' })
      const msg3 = makeMsg({ id: 'msg-3', role: 'user', content: 'follow-up', snapshotSha: 'snap2' })

      const { actions, getSession: get } = createActions({
        messages: [msg1, msg2, msg3],
        sdkSessionId: 'sdk-sess-1'
      })
      await actions.rollbackToUserMessage('sess-1', 'msg-3')
      expect(get().pendingResumeAt).toBe('sdk-uuid-42')
      // sdkSessionId preserved when there IS an anchor
      expect(get().sdkSessionId).toBe('sdk-sess-1')
    })

    it('clears sdkSessionId when rolling back to first message (no anchor)', async () => {
      const msg1 = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'snap1' })

      const { actions, getSession: get } = createActions({
        messages: [msg1],
        sdkSessionId: 'sdk-sess-1'
      })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(get().pendingResumeAt).toBeUndefined()
      expect(get().sdkSessionId).toBeUndefined()
    })
  })

  describe('state cleanup', () => {
    it('sets status to idle and clears activity', async () => {
      const msg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'snap1' })
      const { actions, getSession: get } = createActions({
        status: 'error',
        activity: 'Running...',
        messages: [msg]
      })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(get().status).toBe('idle')
      expect(get().activity).toBeNull()
    })

    it('clears pending prompts', async () => {
      const msg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'snap1' })
      const { actions, getSession: get } = createActions({
        messages: [msg],
        pendingQuestion: { question: 'test' } as AgentSession['pendingQuestion'],
        pendingPlanApproval: { planContent: 'test' } as AgentSession['pendingPlanApproval'],
      })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(get().pendingQuestion).toBeUndefined()
      expect(get().pendingPlanApproval).toBeUndefined()
    })

    it('calls persistSession after rollback', async () => {
      const msg = makeMsg({ id: 'msg-1', role: 'user', snapshotSha: 'snap1' })
      const { actions } = createActions({ messages: [msg] })
      await actions.rollbackToUserMessage('sess-1', 'msg-1')
      expect(persistSession).toHaveBeenCalledWith('sess-1')
    })
  })
})
