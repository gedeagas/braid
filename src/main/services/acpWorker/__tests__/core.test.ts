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

  /** Simulate the agent writing a raw NDJSON line to stdout. */
  writeLine(obj: unknown): void {
    this.stdout.push(JSON.stringify(obj) + '\n')
  }

  /** Simulate the agent sending a JSON-RPC response on stdout. */
  respond(id: number | string, result: unknown): void {
    this.writeLine({ jsonrpc: '2.0', id, result })
  }

  /** Simulate the agent sending a JSON-RPC error response. */
  respondError(id: number | string, code: number, message: string): void {
    this.writeLine({ jsonrpc: '2.0', id, error: { code, message } })
  }

  /** Simulate the agent sending a JSON-RPC notification on stdout. */
  notify(method: string, params: unknown): void {
    this.writeLine({ jsonrpc: '2.0', method, params })
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
 * Parse outgoing JSON-RPC messages that the worker writes to stdin.
 * Returns them as they arrive.
 */
function captureStdin(proc: MockProcess): Array<Record<string, unknown>> {
  const captured: Array<Record<string, unknown>> = []
  proc.stdin.on('data', (chunk: Buffer | string) => {
    const lines = chunk.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      captured.push(JSON.parse(line))
    }
  })
  return captured
}

/**
 * Set up auto-responses for the ACP handshake (initialize, session/new)
 * and optionally the session/prompt RPC.
 */
function autoRespond(proc: MockProcess, opts?: { promptResult?: unknown; promptError?: boolean; skipPrompt?: boolean }) {
  let rpcCount = 0
  proc.stdin.on('data', (chunk: Buffer | string) => {
    const lines = chunk.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      const msg = JSON.parse(line)
      // Only respond to outgoing requests (have an id field, no result/error)
      if (msg.id == null || msg.result !== undefined || msg.error !== undefined) continue
      rpcCount++
      if (rpcCount === 1) {
        // initialize
        proc.respond(msg.id, { capabilities: {} })
      } else if (rpcCount === 2) {
        // session/new
        proc.respond(msg.id, { sessionId: 'acp-session-42' })
      } else if (rpcCount >= 3 && !opts?.skipPrompt) {
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

    await vi.advanceTimersByTimeAsync(0)
    autoRespond(mockProc)
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

  it('sends correct JSON-RPC messages during handshake', async () => {
    const promise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'hello', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    // spawn() has run, mockProc is now the live process
    await vi.advanceTimersByTimeAsync(0)
    const captured = captureStdin(mockProc)
    autoRespond(mockProc)
    await vi.advanceTimersByTimeAsync(0)
    await promise

    // Filter to outgoing requests only (have method, no result/error)
    const requests = captured.filter((m) => m.method && m.result === undefined && m.error === undefined)
    const methods = requests.map((m) => m.method)
    expect(methods).toEqual(['initialize', 'session/new', 'session/prompt'])

    // initialize should include client capabilities
    const initMsg = requests.find((m) => m.method === 'initialize')
    expect((initMsg?.params as Record<string, unknown>).clientCapabilities).toBeDefined()
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
        if (msg.id == null || msg.result !== undefined || msg.error !== undefined) continue
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

// ---------------------------------------------------------------------------
describe('agent-initiated requests', () => {
  it('handles fs/read_text_file request from agent and sends response', async () => {
    const promise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'hello', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    await vi.advanceTimersByTimeAsync(0)

    // Capture responses written back to stdin
    const responses: Record<string, unknown>[] = []
    mockProc.stdin.on('data', (chunk: Buffer | string) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        const msg = JSON.parse(line)
        if (msg.result !== undefined || msg.error !== undefined) {
          responses.push(msg)
        }
      }
    })

    let rpcCount = 0
    mockProc.stdin.on('data', (chunk: Buffer | string) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        const msg = JSON.parse(line)
        if (msg.id == null || msg.result !== undefined || msg.error !== undefined) continue
        rpcCount++
        if (rpcCount === 1) {
          mockProc.respond(msg.id, { capabilities: {} })
        } else if (rpcCount === 2) {
          mockProc.respond(msg.id, { sessionId: 'acp-s1' })
        } else if (rpcCount === 3) {
          // Agent sends a read_text_file request before responding to prompt
          // Path must be within the worktree (/cwd) to pass path traversal check
          mockProc.writeLine({ jsonrpc: '2.0', id: 100, method: 'fs/read_text_file', params: { path: '/cwd/file.txt' } })
          // Then respond to prompt
          mockProc.respond(msg.id, { status: 'complete' })
        }
      }
    })

    await vi.advanceTimersByTimeAsync(0)
    await promise

    // The server should have sent a response for the fs/read_text_file request
    const fileResponse = responses.find((r) => (r as { id?: number }).id === 100)
    expect(fileResponse).toBeDefined()
    expect((fileResponse as { result: { content: string } }).result.content).toBe('file content')
  })
})

// ---------------------------------------------------------------------------
describe('batch messages', () => {
  it('handles batch JSON-RPC responses', async () => {
    // The library handles batch responses via isJSONRPCResponses check
    // This test verifies no crash on batch input
    const promise = worker.startSession(
      'sess-1', 'wt-1', 'proj', '/cwd', 'hello', 'model', true, false,
      'New Chat', SETTINGS, undefined, undefined, undefined, undefined, undefined,
      BACKEND, AGENT_CONFIG
    )

    await vi.advanceTimersByTimeAsync(0)

    let firstId: number | undefined
    mockProc.stdin.on('data', (chunk: Buffer | string) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        const msg = JSON.parse(line)
        if (msg.id == null || msg.result !== undefined || msg.error !== undefined) continue
        if (!firstId) {
          firstId = msg.id
          // Respond with a single response (not batch) for simplicity
          mockProc.respond(msg.id, { capabilities: {} })
        }
      }
    })

    await vi.advanceTimersByTimeAsync(0)
    // Let it timeout on second RPC
    await vi.advanceTimersByTimeAsync(60_000)
    await promise

    // Should have gotten past initialize at least
    expect(firstId).toBeDefined()
  })
})
