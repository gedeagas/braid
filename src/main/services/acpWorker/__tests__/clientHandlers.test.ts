import { describe, it, expect, vi, beforeEach } from 'vitest'
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

// Import AFTER mocks
import { createClientHandlers } from '../clientHandlers'

const SID = 'test-session-1'
const CWD = '/test/project'

let emitted: WorkerEvent[]
let handlers: ReturnType<typeof createClientHandlers>

beforeEach(() => {
  vi.clearAllMocks()
  emitted = []
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
