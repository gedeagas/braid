import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type { WorkerEvent } from '../../agentTypes'

// --- Mock fs ----------------------------------------------------------------
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()

vi.mock('fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}))

// --- Mock child_process.spawn ------------------------------------------------
function createMockChildProcess() {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: null,
    pid: 12345,
    kill: vi.fn(() => {
      if (!proc._exited) {
        proc._exited = true
        proc.emit('exit', null, 'SIGTERM')
      }
      return true
    }),
    _exited: false,
  })
  return proc
}

let mockProcs: ReturnType<typeof createMockChildProcess>[]

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const proc = createMockChildProcess()
    mockProcs.push(proc)
    return proc
  }),
}))

// Import AFTER mocks
import { createClientHandlers } from '../clientHandlers'

const SID = 'test-session-1'
const CWD = '/test/project'

let emitted: WorkerEvent[]
let handlers: ReturnType<typeof createClientHandlers>

beforeEach(() => {
  vi.clearAllMocks()
  emitted = []
  mockProcs = []
  handlers = createClientHandlers(SID, CWD, (event) => emitted.push(event))
})

// ---------------------------------------------------------------------------
describe('sessionUpdate', () => {
  it('emits WorkerEvents for known update types', () => {
    handlers.sessionUpdate({ type: 'agent_message_chunk', content: { text: 'Hello' } })

    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted[0].type).toBe('sdk_message')
  })

  it('emits nothing for unknown update types', () => {
    handlers.sessionUpdate({ type: 'some_future_type' })
    expect(emitted).toHaveLength(0)
  })

  it('mutates turn state through sessionUpdate', () => {
    handlers.sessionUpdate({ type: 'agent_message_chunk', content: { text: 'Hi' } })
    const turn = handlers.getTurnState()
    expect(turn.started).toBe(true)
    expect(turn.textBlockStarted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('resetTurn', () => {
  it('creates fresh turn state', () => {
    handlers.sessionUpdate({ type: 'agent_message_chunk', content: { text: 'Hi' } })
    expect(handlers.getTurnState().started).toBe(true)

    handlers.resetTurn()
    expect(handlers.getTurnState().started).toBe(false)
    expect(handlers.getTurnState().textBlockStarted).toBe(false)
    expect(handlers.getTurnState().blockIndex).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('requestPermission', () => {
  it('emits waiting_input event with tool_permission reason', async () => {
    const promise = handlers.requestPermission({
      toolCall: { name: 'WriteFile', input: { path: '/foo' } },
      message: 'Write to /foo?',
    })

    expect(emitted).toHaveLength(1)
    const event = emitted[0] as Record<string, unknown>
    expect(event.type).toBe('waiting_input')
    expect(event.reason).toBe('tool_permission')
    expect(event.toolName).toBe('WriteFile')
    expect(event.description).toBe('Write to /foo?')

    // Resolve the permission
    const permId = event.toolUseId as string
    handlers.resolvePermission(permId, { behavior: 'allow' })

    const result = await promise
    expect(result.optionId).toBe('allow_once')
  })

  it('resolves as reject_once when behavior is deny', async () => {
    const promise = handlers.requestPermission({ toolCall: { name: 'Bash' } })
    const permId = (emitted[0] as Record<string, unknown>).toolUseId as string

    handlers.resolvePermission(permId, { behavior: 'deny' })

    const result = await promise
    expect(result.optionId).toBe('reject_once')
  })

  it('defaults to Unknown when toolCall is missing', () => {
    handlers.requestPermission({})
    const event = emitted[0] as Record<string, unknown>
    expect(event.toolName).toBe('Unknown')
  })

  it('generates unique permission IDs', () => {
    handlers.requestPermission({ toolCall: { name: 'A' } })
    handlers.requestPermission({ toolCall: { name: 'B' } })

    const id1 = (emitted[0] as Record<string, unknown>).toolUseId
    const id2 = (emitted[1] as Record<string, unknown>).toolUseId
    expect(id1).not.toBe(id2)
  })
})

// ---------------------------------------------------------------------------
describe('resolvePermission', () => {
  it('is a no-op for unknown permission IDs', () => {
    // Should not throw
    handlers.resolvePermission('non-existent-id', { behavior: 'allow' })
  })

  it('only resolves each permission once', async () => {
    const promise = handlers.requestPermission({ toolCall: { name: 'Test' } })
    const permId = (emitted[0] as Record<string, unknown>).toolUseId as string

    handlers.resolvePermission(permId, { behavior: 'allow' })
    // Second call is a no-op
    handlers.resolvePermission(permId, { behavior: 'deny' })

    const result = await promise
    // First resolution wins
    expect(result.optionId).toBe('allow_once')
  })
})

// ---------------------------------------------------------------------------
describe('cleanup', () => {
  it('resolves all pending permissions as reject_once', async () => {
    const p1 = handlers.requestPermission({ toolCall: { name: 'A' } })
    const p2 = handlers.requestPermission({ toolCall: { name: 'B' } })

    handlers.cleanup()

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.optionId).toBe('reject_once')
    expect(r2.optionId).toBe('reject_once')
  })

  it('clears the pending map so resolvePermission is a no-op after cleanup', async () => {
    const promise = handlers.requestPermission({ toolCall: { name: 'X' } })
    const permId = (emitted[0] as Record<string, unknown>).toolUseId as string

    handlers.cleanup()

    // Attempt to resolve after cleanup is a no-op (already resolved by cleanup)
    handlers.resolvePermission(permId, { behavior: 'allow' })

    const result = await promise
    expect(result.optionId).toBe('reject_once') // cleanup wins
  })

  it('is safe to call multiple times', () => {
    handlers.cleanup()
    handlers.cleanup()
    // No errors thrown
  })
})

// ---------------------------------------------------------------------------
describe('readTextFile', () => {
  it('reads file content within the worktree', async () => {
    mockReadFileSync.mockReturnValue('file contents here')

    const result = await handlers.readTextFile({ path: '/test/project/file.txt' })

    expect(result).toEqual({ content: 'file contents here' })
    expect(mockReadFileSync).toHaveBeenCalledWith('/test/project/file.txt', 'utf-8')
  })

  it('resolves relative paths against worktree root', async () => {
    mockReadFileSync.mockReturnValue('ok')

    const result = await handlers.readTextFile({ path: 'src/index.ts' })

    expect(result).toEqual({ content: 'ok' })
    expect(mockReadFileSync).toHaveBeenCalledWith('/test/project/src/index.ts', 'utf-8')
  })

  it('rejects path traversal attempts', async () => {
    await expect(handlers.readTextFile({ path: '/etc/passwd' }))
      .rejects.toThrow('Path traversal denied')
  })

  it('rejects relative path traversal via ..', async () => {
    await expect(handlers.readTextFile({ path: '../../../etc/passwd' }))
      .rejects.toThrow('Path traversal denied')
  })

  it('propagates errors from readFileSync', async () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT') })

    await expect(handlers.readTextFile({ path: '/test/project/missing' })).rejects.toThrow('ENOENT')
  })
})

// ---------------------------------------------------------------------------
describe('writeTextFile', () => {
  it('creates parent dir and writes file within worktree', async () => {
    const result = await handlers.writeTextFile({ path: '/test/project/sub/out.txt', content: 'data' })

    expect(result).toBeNull()
    expect(mockMkdirSync).toHaveBeenCalledWith('/test/project/sub', { recursive: true })
    expect(mockWriteFileSync).toHaveBeenCalledWith('/test/project/sub/out.txt', 'data', 'utf-8')
  })

  it('rejects path traversal on write', async () => {
    await expect(handlers.writeTextFile({ path: '/tmp/malicious.txt', content: 'bad' }))
      .rejects.toThrow('Path traversal denied')
  })
})

// ---------------------------------------------------------------------------
describe('createTerminal', () => {
  it('creates a terminal and returns a unique ID', async () => {
    const result = await handlers.createTerminal({ command: 'echo', args: ['hello'] })

    expect(result.terminalId).toMatch(/^term-/)
    expect(mockProcs).toHaveLength(1)
  })

  it('generates unique IDs for multiple terminals', async () => {
    const r1 = await handlers.createTerminal({ command: 'ls' })
    const r2 = await handlers.createTerminal({ command: 'pwd' })

    expect(r1.terminalId).not.toBe(r2.terminalId)
  })
})

// ---------------------------------------------------------------------------
describe('terminalOutput', () => {
  it('captures stdout output', async () => {
    const { terminalId } = await handlers.createTerminal({ command: 'echo', args: ['hi'] })
    const proc = mockProcs[0]

    proc.stdout.emit('data', 'hello world\n')

    const result = await handlers.terminalOutput({ terminalId })
    expect(result.output).toBe('hello world\n')
    expect(result.truncated).toBe(false)
    expect(result.exitStatus).toBeNull() // still running
  })

  it('merges stderr into output', async () => {
    const { terminalId } = await handlers.createTerminal({ command: 'test' })
    const proc = mockProcs[0]

    proc.stdout.emit('data', 'out\n')
    proc.stderr.emit('data', 'err\n')

    const result = await handlers.terminalOutput({ terminalId })
    expect(result.output).toBe('out\nerr\n')
  })

  it('returns exitStatus after process exits', async () => {
    const { terminalId } = await handlers.createTerminal({ command: 'ls' })
    const proc = mockProcs[0]

    proc._exited = true
    proc.emit('exit', 0, null)

    const result = await handlers.terminalOutput({ terminalId })
    expect(result.exitStatus).toEqual({ exitCode: 0, signal: null })
  })

  it('throws for unknown terminal ID', async () => {
    await expect(handlers.terminalOutput({ terminalId: 'bogus' }))
      .rejects.toThrow('Terminal not found')
  })
})

// ---------------------------------------------------------------------------
describe('waitForExit', () => {
  it('resolves when process exits', async () => {
    const { terminalId } = await handlers.createTerminal({ command: 'sleep' })
    const proc = mockProcs[0]

    // Simulate exit after a tick
    setTimeout(() => { proc._exited = true; proc.emit('exit', 42, null) }, 5)

    const result = await handlers.waitForExit({ terminalId })
    expect(result.exitCode).toBe(42)
    expect(result.signal).toBeNull()
  })

  it('returns signal when killed', async () => {
    const { terminalId } = await handlers.createTerminal({ command: 'sleep' })
    const proc = mockProcs[0]

    setTimeout(() => { proc._exited = true; proc.emit('exit', null, 'SIGKILL') }, 5)

    const result = await handlers.waitForExit({ terminalId })
    expect(result.exitCode).toBeNull()
    expect(result.signal).toBe('SIGKILL')
  })
})

// ---------------------------------------------------------------------------
describe('killTerminal', () => {
  it('sends SIGTERM to the process', async () => {
    const { terminalId } = await handlers.createTerminal({ command: 'sleep' })
    const proc = mockProcs[0]

    await handlers.killTerminal({ terminalId })
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('is a no-op if already exited', async () => {
    const { terminalId } = await handlers.createTerminal({ command: 'true' })
    const proc = mockProcs[0]

    proc._exited = true
    proc.emit('exit', 0, null)

    await handlers.killTerminal({ terminalId })
    expect(proc.kill).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe('releaseTerminal', () => {
  it('kills and removes the terminal', async () => {
    const { terminalId } = await handlers.createTerminal({ command: 'sleep' })

    await handlers.releaseTerminal({ terminalId })

    // After release, output should throw
    await expect(handlers.terminalOutput({ terminalId }))
      .rejects.toThrow('Terminal not found')
  })

  it('is safe to call on unknown ID', async () => {
    await expect(handlers.releaseTerminal({ terminalId: 'bogus' }))
      .resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('cleanup with terminals', () => {
  it('kills all running terminals', async () => {
    await handlers.createTerminal({ command: 'sleep', args: ['100'] })
    await handlers.createTerminal({ command: 'sleep', args: ['200'] })

    handlers.cleanup()

    expect(mockProcs[0].kill).toHaveBeenCalledWith('SIGKILL')
    expect(mockProcs[1].kill).toHaveBeenCalledWith('SIGKILL')
  })
})
