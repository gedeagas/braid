import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import type { AgentSession, Message } from '@/types'

vi.mock('../persistence', () => ({ persistSession: vi.fn(), bindSessionsStore: vi.fn() }))
vi.mock('../streaming', () => ({
  startPeriodicFlush: vi.fn(),
  stopPeriodicFlush: vi.fn(),
  flushStreamingBuffer: vi.fn()
}))
vi.mock('../handlers/notifications', () => ({
  maybeShowToast: vi.fn(),
  fireDesktopNotification: vi.fn(),
  createNotificationDeps: vi.fn(() => ({}))
}))
vi.mock('../handlers/titleManager', () => ({
  resolveEagerTitle: vi.fn().mockResolvedValue(undefined),
  scheduleRefinedTitle: vi.fn(),
  createTitleManagerDeps: vi.fn(() => ({}))
}))
vi.mock('../storage', () => ({
  sessionWorktreePaths: new Map(),
  pendingTitleGenerations: new Map()
}))

import { handleDone } from '../handlers/handleDone'
import { persistSession } from '../persistence'
import { maybeShowToast, fireDesktopNotification } from '../handlers/notifications'
import { resolveEagerTitle, scheduleRefinedTitle } from '../handlers/titleManager'
import type { HandlerContext } from '../handlers/types'

type QueuedMsg = { text: string; images?: string[] }

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-1', worktreeId: 'wt-1', name: 'My Session', customName: false,
    status: 'running', model: 'claude-sonnet-4-6', thinkingEnabled: false,
    extendedContext: false, effortLevel: 'high', planModeEnabled: false, messages: [], activity: 'Running Bash...',
    runStartedAt: Date.now() - 5000, runCompletedAt: null, totalRunDurationMs: 0,
    tokenUsage: null, contextTokens: null, createdAt: Date.now(), ...overrides
  }
}

function makeStore(session: Partial<AgentSession> = {}, queued: QueuedMsg | null = null) {
  const store = create<{
    sessions: Record<string, AgentSession>
    queuedMessages: Record<string, QueuedMsg>
    streamingTextBuffers: Record<string, string>
    sendMessage: ReturnType<typeof vi.fn>
  }>()((set) => ({
    sessions: { 'sess-1': makeSession(session) },
    queuedMessages: (queued ? { 'sess-1': queued } : {}) as Record<string, QueuedMsg>,
    streamingTextBuffers: {},
    sendMessage: vi.fn()
  }))
  return store as unknown as import('../stateUtils').Store
}

function makeCtx(store: import('../stateUtils').Store): HandlerContext {
  return { store, sessionId: 'sess-1' }
}

function getSession(store: import('../stateUtils').Store): AgentSession {
  return (store.getState() as { sessions: Record<string, AgentSession> }).sessions['sess-1']
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function noQueue(_id: string): QueuedMsg | null { return null }
function noDrain(_id: string): void { }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleDone', () => {
  beforeEach(() => {
    vi.mocked(persistSession).mockClear()
    vi.mocked(maybeShowToast).mockClear()
    vi.mocked(fireDesktopNotification).mockClear()
    vi.mocked(resolveEagerTitle).mockClear()
    vi.mocked(scheduleRefinedTitle).mockClear()
  })

  it('sets status to idle from running', async () => {
    const store = makeStore()
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(getSession(store).status).toBe('idle')
  })

  it('preserves waiting_input status when already set', async () => {
    const store = makeStore({ status: 'waiting_input' })
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(getSession(store).status).toBe('waiting_input')
  })

  it('clears activity when transitioning to idle', async () => {
    const store = makeStore({ status: 'running', activity: 'Running Bash...' })
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(getSession(store).activity).toBeNull()
  })

  it('preserves activity when status stays waiting_input', async () => {
    const store = makeStore({ status: 'waiting_input', activity: 'Waiting for approval...' })
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(getSession(store).activity).toBe('Waiting for approval...')
  })

  it('seals all partial messages', async () => {
    const partial: Message = { id: 'p-1', role: 'assistant', content: 'incomplete', isPartial: true, timestamp: Date.now() }
    const store = makeStore({ messages: [partial] })
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(getSession(store).messages[0].isPartial).toBe(false)
  })

  it('sets runCompletedAt and clears runStartedAt', async () => {
    const before = Date.now()
    const store = makeStore()
    await handleDone(makeCtx(store), noQueue, noDrain)
    const s = getSession(store)
    expect(s.runStartedAt).toBeNull()
    expect(s.runCompletedAt).toBeGreaterThanOrEqual(before)
  })

  it('accumulates totalRunDurationMs', async () => {
    const store = makeStore({ runStartedAt: Date.now() - 3000, totalRunDurationMs: 1000 })
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(getSession(store).totalRunDurationMs).toBeGreaterThan(1000)
  })

  it('calls persistSession', async () => {
    const store = makeStore()
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(persistSession).toHaveBeenCalledWith('sess-1')
  })

  it('calls resolveEagerTitle', async () => {
    const store = makeStore()
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(resolveEagerTitle).toHaveBeenCalledWith('sess-1', store, expect.anything())
  })

  it('calls scheduleRefinedTitle', async () => {
    const store = makeStore()
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(scheduleRefinedTitle).toHaveBeenCalled()
  })

  it('calls maybeShowToast with done when status is idle', async () => {
    const store = makeStore()
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(maybeShowToast).toHaveBeenCalledWith('sess-1', 'done', expect.anything())
  })

  it('calls fireDesktopNotification when status is idle', async () => {
    const store = makeStore()
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(fireDesktopNotification).toHaveBeenCalledWith(
      'sess-1', 'done', 'My Session', expect.anything()
    )
  })

  it('does not notify when status is waiting_input after done', async () => {
    const store = makeStore({ status: 'waiting_input' })
    await handleDone(makeCtx(store), noQueue, noDrain)
    expect(maybeShowToast).not.toHaveBeenCalled()
    expect(fireDesktopNotification).not.toHaveBeenCalled()
  })

  it('drains queued message via drainQueue and sendMessage', async () => {
    const store = makeStore()
    const queued: QueuedMsg = { text: 'Next message', images: [] }
    const getQueue = vi.fn().mockReturnValue(queued)
    const drain = vi.fn()
    const sendMessage = vi.fn()
    ;(store.getState() as unknown as { sendMessage: typeof sendMessage }).sendMessage = sendMessage

    await handleDone(makeCtx(store), getQueue, drain)

    expect(drain).toHaveBeenCalledWith('sess-1')
    expect(sendMessage).toHaveBeenCalledWith('sess-1', 'Next message', [])
  })

  it('does not drain when queued message is empty text and no images', async () => {
    const store = makeStore()
    const queued: QueuedMsg = { text: '   ', images: [] }
    const drain = vi.fn()
    await handleDone(makeCtx(store), () => queued, drain)
    expect(drain).not.toHaveBeenCalled()
  })

  it('does not drain when no queued message', async () => {
    const store = makeStore()
    const drain = vi.fn()
    await handleDone(makeCtx(store), noQueue, drain)
    expect(drain).not.toHaveBeenCalled()
  })

  it('sends image-only queued message with image tags', async () => {
    const store = makeStore()
    const queued: QueuedMsg = { text: '', images: ['data:image/png;base64,abc'] }
    const drain = vi.fn()
    const sendMessage = vi.fn()
    ;(store.getState() as unknown as { sendMessage: typeof sendMessage }).sendMessage = sendMessage

    await handleDone(makeCtx(store), () => queued, drain)

    const [, promptArg] = sendMessage.mock.calls[0]
    expect(promptArg).toContain('[Image 1]')
  })

  it('skips queue drain when isEditingQueue returns true', async () => {
    const store = makeStore()
    const queued: QueuedMsg = { text: 'Editing...', images: [] }
    const drain = vi.fn()
    const sendMessage = vi.fn()
    ;(store.getState() as unknown as { sendMessage: typeof sendMessage }).sendMessage = sendMessage

    await handleDone(makeCtx(store), () => queued, drain, () => true)

    expect(drain).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('drains queue when isEditingQueue returns false', async () => {
    const store = makeStore()
    const queued: QueuedMsg = { text: 'Ready to send', images: [] }
    const drain = vi.fn()
    const sendMessage = vi.fn()
    ;(store.getState() as unknown as { sendMessage: typeof sendMessage }).sendMessage = sendMessage

    await handleDone(makeCtx(store), () => queued, drain, () => false)

    expect(drain).toHaveBeenCalledWith('sess-1')
    expect(sendMessage).toHaveBeenCalledWith('sess-1', 'Ready to send', [])
  })

  it('does nothing when session does not exist', async () => {
    const store = makeStore()
    const ctx: HandlerContext = { store, sessionId: 'nonexistent' }
    await handleDone(ctx, noQueue, noDrain)
    expect(persistSession).not.toHaveBeenCalled()
  })
})
