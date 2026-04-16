import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter, PassThrough } from 'stream'
import type { WorkerEvent, AcpAgentConfig } from '../../agentTypes'

// --- Mock child_process.spawn -----------------------------------------------

class MockProcess extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = null
  pid = 12345
  killed = false

  kill(signal?: string) {
    this.killed = true
    this.emit('exit', signal === 'SIGKILL' ? 9 : 0)
  }

  /** Simulate the agent sending a JSON-RPC response on stdout. */
  respond(id: number, result: unknown): void {
    this.stdout.push(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
  }

  /** Simulate the agent sending a JSON-RPC notification on stdout. */
  notify(method: string, params: unknown): void {
    this.stdout.push(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  /** Simulate the agent sending a JSON-RPC error response. */
  respondError(id: number, code: number, message: string): void {
    this.stdout.push(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
  }
}

let mockProc: MockProcess

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    mockProc = new MockProcess()
    return mockProc
  }),
}))

// Mock fs (needed by clientHandlers)
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'file content'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

// Import AFTER mocks
import { AcpWorker } from '../core'

const AGENT_CONFIG: AcpAgentConfig = {
  id: 'test-agent',
  name: 'Test Agent',
  command: '/usr/bin/test-agent',
  args: ['--stdio'],
  env: { AGENT_MODE: 'acp' },
}

const SETTINGS = {
  apiKey: null,
  systemPromptSuffix: '',
  claudeCodeExecutablePath: '',
  bypassPermissions: true,
}

const BACKEND = { type: 'acp' as const, agentId: 'test-agent', agentName: 'Test Agent' }

let emitted: WorkerEvent[]
let worker: AcpWorker

/**
 * Automatically respond to the ACP handshake (initialize, session/new)
 * and optionally the session/prompt RPC. Each RPC is identified by its
 * sequential ID (1, 2, 3...).
 */
function autoRespond(proc: MockProcess, opts?: { promptResult?: unknown; promptError?: boolean }) {
  let rpcCount = 0
  proc.stdin.on('data', (chunk: Buffer | string) => {
    const lines = chunk.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      const msg = JSON.parse(line)
      rpcCount++
      if (rpcCount === 1) {
        // initialize
        proc.respond(msg.id, { capabilities: {} })
      } else if (rpcCount === 2) {
        // session/new
        proc.respond(msg.id, { sessionId: 'acp-session-42' })
      } else if (rpcCount === 3) {
        // session/prompt
        if (opts?.promptError) {
          proc.respondError(msg.id, -32000, 'Agent failed')
        } else {
          proc.respond(msg.id, opts?.promptResult ?? { status: 'complete' })
        }
      }
    }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  emitted = []
  worker = new AcpWorker((event) => emitted.push(event))
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
describe('startSession', () => {
  it('emits error when no agent config is provided', async () => {
    await worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'hello', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, undefined // no agentConfig
    )

    expect(emitted).toHaveLength(1)
    expect(emitted[0].type).toBe('error')
    expect((emitted[0] as { message: string }).message).toContain('not found in configuration')
  })

  it('completes handshake and emits init + done', async () => {
    const promise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'Say hello', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    // Wait for stdin writes to propagate
    await vi.advanceTimersByTimeAsync(0)
    autoRespond(mockProc)
    // Re-trigger so stdin handler fires
    await vi.advanceTimersByTimeAsync(0)
    await promise

    const types = emitted.map((e) => e.type)
    expect(types).toContain('init')
    expect(types).toContain('done')

    // init event should have the ACP session ID
    const init = emitted.find((e) => e.type === 'init') as { sdkSessionId: string }
    expect(init.sdkSessionId).toBe('acp-session-42')
  })

  it('emits error when RPC fails', async () => {
    const promise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'fail', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    await vi.advanceTimersByTimeAsync(0)
    autoRespond(mockProc, { promptError: true })
    await vi.advanceTimersByTimeAsync(0)
    await promise

    const errors = emitted.filter((e) => e.type === 'error')
    expect(errors.length).toBeGreaterThan(0)
    expect((errors[0] as { message: string }).message).toContain('Agent failed')
  })
})

// ---------------------------------------------------------------------------
describe('sendMessage', () => {
  it('emits error for unknown session', async () => {
    await worker.sendMessage(
      'non-existent', 'hi', 'sdk-1', '/cwd', 'model', false,
      'New Chat', SETTINGS
    )

    expect(emitted).toHaveLength(1)
    expect(emitted[0].type).toBe('error')
    expect((emitted[0] as { message: string }).message).toContain('not found')
  })
})

// ---------------------------------------------------------------------------
describe('stopSession', () => {
  it('kills the agent process and emits done', async () => {
    // Start a session first (won't complete - we just need the session registered)
    const startPromise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'hi', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    await vi.advanceTimersByTimeAsync(0)
    autoRespond(mockProc)
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    emitted.length = 0

    worker.stopSession('sess-1')
    expect(emitted.some((e) => e.type === 'done')).toBe(true)
  })

  it('is safe to call for unknown session', () => {
    worker.stopSession('non-existent')
    expect(emitted.some((e) => e.type === 'done')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('closeSession', () => {
  it('kills process with SIGKILL', async () => {
    const startPromise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'hi', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    await vi.advanceTimersByTimeAsync(0)
    autoRespond(mockProc)
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    worker.closeSession('sess-1')
    expect(mockProc.killed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('answerToolInput', () => {
  it('is safe to call for unknown session', () => {
    // Should not throw
    worker.answerToolInput('non-existent', { toolUseId: 'perm-1', behavior: 'allow' })
  })
})

// ---------------------------------------------------------------------------
describe('RPC timeout', () => {
  it('rejects after RPC_TIMEOUT_MS', async () => {
    const promise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'hi', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    // Don't respond - let the timeout fire
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60_000)
    await promise

    const errors = emitted.filter((e) => e.type === 'error')
    expect(errors.length).toBeGreaterThan(0)
    expect((errors[0] as { message: string }).message).toContain('timeout')
  })
})

// ---------------------------------------------------------------------------
describe('handleIncomingMessage - string IDs', () => {
  it('resolves pending RPC when agent responds with string ID', async () => {
    const promise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'test', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    await vi.advanceTimersByTimeAsync(0)

    // Intercept the stdin write and respond with a string ID
    let rpcCount = 0
    mockProc.stdin.on('data', (chunk: Buffer | string) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        const msg = JSON.parse(line)
        rpcCount++
        // Respond with string version of the numeric ID
        mockProc.stdout.push(
          JSON.stringify({ jsonrpc: '2.0', id: String(msg.id), result: rpcCount === 2 ? { sessionId: 's1' } : {} }) + '\n'
        )
      }
    })

    await vi.advanceTimersByTimeAsync(0)
    await promise

    // Should complete without timeout errors
    const errors = emitted.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('session update notifications during prompt', () => {
  it('processes notifications and includes them in turn state', async () => {
    const promise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'hello', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    await vi.advanceTimersByTimeAsync(0)

    let rpcCount = 0
    mockProc.stdin.on('data', (chunk: Buffer | string) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        const msg = JSON.parse(line)
        rpcCount++
        if (rpcCount === 1) {
          mockProc.respond(msg.id, { capabilities: {} })
        } else if (rpcCount === 2) {
          mockProc.respond(msg.id, { sessionId: 'acp-s1' })
        } else if (rpcCount === 3) {
          // Send notifications BEFORE the response
          mockProc.notify('session/update', { type: 'agent_message_chunk', content: { text: 'Hello world' } })
          mockProc.respond(msg.id, { status: 'complete' })
        }
      }
    })

    await vi.advanceTimersByTimeAsync(0)
    await promise

    // Should have sdk_message events from the notification
    const sdkMessages = emitted.filter((e) => e.type === 'sdk_message')
    expect(sdkMessages.length).toBeGreaterThan(0)

    // And init + done
    expect(emitted.some((e) => e.type === 'init')).toBe(true)
    expect(emitted.some((e) => e.type === 'done')).toBe(true)
  })
})
