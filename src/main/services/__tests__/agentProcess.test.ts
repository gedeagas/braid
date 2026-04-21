import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from 'vitest'
import { EventEmitter } from 'events'
import type { WorkerEvent, AgentSettings } from '../agentTypes'
import type { WorkerCommand } from '../agentProcessTypes'

// ── SDK mock ──────────────────────────────────────────────────────────
function makeAsyncIterable(messages: unknown[]) {
  const msgs = [...messages]
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () =>
        msgs.length
          ? { value: msgs.shift(), done: false }
          : { value: undefined, done: true }
    }),
    supportedCommands: vi.fn().mockResolvedValue([])
  }
}

const mockQuery = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  createSdkMcpServer: vi.fn().mockReturnValue({ type: 'sdk', name: 'braid', instance: {} }),
  tool: vi.fn().mockImplementation((name: string) => ({ name })),
}))

vi.mock('../git', () => ({
  gitService: {
    getStagedDiff: vi.fn(),
    getStagedFiles: vi.fn()
  }
}))

vi.mock('../git/status', () => ({
  getStatus: vi.fn().mockResolvedValue([])
}))

vi.mock('../git/worktrees', () => ({
  addWorktree: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../github', () => ({
  githubService: {
    getPrStatus: vi.fn().mockResolvedValue(null),
    getChecks: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT') })
    },
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT') })
  }
})

import { gitService } from '../git'

const defaultSettings: AgentSettings = { apiKey: null, systemPromptSuffix: '', claudeCodeExecutablePath: '', bypassPermissions: true }

/**
 * Simulate the UtilityProcess environment by mocking process.parentPort
 * and importing the entry point module.
 *
 * IMPORTANT: parentPort is created once and the module imported once.
 * The module registers its listener on parentPort at import time, so we
 * must NOT recreate parentPort between tests — only swap out the
 * postMessage spy to collect per-test messages.
 */
describe('agentProcess entry point', () => {
  const parentPort = Object.assign(new EventEmitter(), {
    postMessage: vi.fn()
  })
  let posted: unknown[]

  beforeAll(async () => {
    ;(process as unknown as Record<string, unknown>).parentPort = parentPort
    await import('../agentProcess')
  })

  beforeEach(() => {
    mockQuery.mockReset()
    posted = []
    parentPort.postMessage = vi.fn((msg: unknown) => posted.push(msg))
  })

  function sendCommand(cmd: WorkerCommand): void {
    parentPort.emit('message', { data: cmd })
  }

  /** Poll until `predicate` returns true, or time out. */
  async function waitFor(
    predicate: () => boolean,
    ms = 2000,
    interval = 10
  ): Promise<void> {
    const deadline = Date.now() + ms
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('waitFor timed out')
      await new Promise((r) => setTimeout(r, interval))
    }
  }

  async function flushMicrotasks(): Promise<void> {
    await new Promise((r) => setTimeout(r, 10))
  }

  it('dispatches startSession and streams back events', async () => {
    mockQuery.mockReturnValue(makeAsyncIterable([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }
    ]))

    sendCommand({
      type: 'startSession', sessionId: 's1', worktreeId: 'wt-1', projectName: 'test',
      worktreePath: '/tmp', prompt: 'hello', model: 'claude-sonnet-4-6', thinking: false, extendedContext: false, effortLevel: 'high',
      planMode: false, sessionName: 'Test', settings: defaultSettings
    })

    const events = posted as WorkerEvent[]
    await waitFor(() => events.some(e => e.type === 'done'))

    expect(events.some(e => e.type === 'sdk_message')).toBe(true)
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('dispatches generateCommitMessage and returns result', async () => {
    vi.mocked(gitService.getStagedDiff as Mock).mockResolvedValue('diff content')
    vi.mocked(gitService.getStagedFiles as Mock).mockResolvedValue(['file.ts'])
    mockQuery.mockReturnValue(makeAsyncIterable([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'feat: add feature' }] } }
    ]))

    sendCommand({
      type: 'generateCommitMessage', requestId: 'req-1',
      worktreePath: '/tmp', settings: defaultSettings
    })

    await waitFor(() =>
      posted.some((m) =>
        (m as { type: string }).type === 'result' &&
        (m as { requestId: string }).requestId === 'req-1'
      )
    )

    const result = posted.find(
      (m) => (m as { type: string }).type === 'result' &&
             (m as { requestId: string }).requestId === 'req-1'
    ) as { type: string; requestId: string; value: string }

    expect(result.value).toBe('feat: add feature')
  })

  it('returns result_error when generation fails', async () => {
    vi.mocked(gitService.getStagedDiff as Mock).mockResolvedValue('')
    vi.mocked(gitService.getStagedFiles as Mock).mockResolvedValue([])

    sendCommand({
      type: 'generateCommitMessage', requestId: 'req-2',
      worktreePath: '/tmp', settings: defaultSettings
    })

    await waitFor(() =>
      posted.some((m) =>
        (m as { type: string }).type === 'result_error' &&
        (m as { requestId: string }).requestId === 'req-2'
      )
    )

    const error = posted.find(
      (m) => (m as { type: string }).type === 'result_error' &&
             (m as { requestId: string }).requestId === 'req-2'
    ) as { type: string; requestId: string; message: string }

    expect(error.message).toContain('No staged changes')
  })

  it('dispatches stopSession without crashing', async () => {
    mockQuery.mockReturnValue(makeAsyncIterable([]))
    sendCommand({
      type: 'startSession', sessionId: 's2', worktreeId: 'wt-2', projectName: 'test',
      worktreePath: '/tmp', prompt: 'hi', model: 'claude-sonnet-4-6', thinking: false, extendedContext: false, effortLevel: 'high',
      planMode: false, sessionName: 'Test', settings: defaultSettings
    })
    await waitFor(() =>
      posted.some((m) => (m as { type: string }).type === 'done')
    )

    // stopSession should not throw
    sendCommand({ type: 'stopSession', sessionId: 's2' })
    await flushMicrotasks()
  })

  it('dispatches answerToolInput without crashing', async () => {
    sendCommand({ type: 'answerToolInput', sessionId: 's3', result: { behavior: 'allow' } })
    await flushMicrotasks()
    // No crash = success (no pending input to resolve)
  })

  it('swallows EPIPE from postMessage and does not crash', async () => {
    mockQuery.mockReturnValue(makeAsyncIterable([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }
    ]))

    const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    parentPort.postMessage = vi.fn(() => { throw epipe })

    // If EPIPE is not swallowed, this would throw an unhandled exception and fail.
    await expect(
      new Promise<void>((resolve) => {
        sendCommand({
          type: 'startSession', sessionId: 's-epipe', worktreeId: 'wt-epipe', projectName: 'test',
          worktreePath: '/tmp', prompt: 'hello', model: 'claude-sonnet-4-6', thinking: false,
          planMode: false, sessionName: 'Test', settings: defaultSettings
        })
        setTimeout(resolve, 200)
      })
    ).resolves.toBeUndefined()
  })
})
