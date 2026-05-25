import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RingBuffer, SessionHost } from '../sessionHost'

// ── RingBuffer tests ──────────────────────────────────────────────────────────

describe('RingBuffer', () => {
  it('stores and reads data', () => {
    const buf = new RingBuffer()
    buf.push('hello')
    buf.push(' world')
    expect(buf.read()).toBe('hello world')
  })

  it('evicts old chunks when exceeding max length', () => {
    const buf = new RingBuffer()
    // Push 60KB of data (exceeds 50KB limit)
    const chunk = 'x'.repeat(10_000)
    for (let i = 0; i < 6; i++) buf.push(chunk)
    const result = buf.read()
    expect(result.length).toBeLessThanOrEqual(50_000)
  })

  it('trims a single large chunk', () => {
    const buf = new RingBuffer()
    buf.push('x'.repeat(100_000))
    expect(buf.read().length).toBe(50_000)
  })

  it('clears data', () => {
    const buf = new RingBuffer()
    buf.push('data')
    buf.clear()
    expect(buf.read()).toBe('')
  })

  it('handles empty pushes', () => {
    const buf = new RingBuffer()
    buf.push('')
    buf.push('')
    expect(buf.read()).toBe('')
  })
})

// ── SessionHost tests ─────────────────────────────────────────────────────────

// Mock node-pty
function createMockPty() {
  const dataCallbacks: Array<(data: string) => void> = []
  const exitCallbacks: Array<(info: { exitCode: number }) => void> = []

  return {
    onData: vi.fn((cb: (data: string) => void) => { dataCallbacks.push(cb) }),
    onExit: vi.fn((cb: (info: { exitCode: number }) => void) => { exitCallbacks.push(cb) }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      // Simulate exit on kill
      for (const cb of exitCallbacks) cb({ exitCode: 0 })
    }),
    _emitData: (data: string) => { for (const cb of dataCallbacks) cb(data) },
    _emitExit: (exitCode: number) => { for (const cb of exitCallbacks) cb({ exitCode }) },
  }
}

vi.mock('node-pty', () => {
  let mockPty: ReturnType<typeof createMockPty> | null = null
  return {
    spawn: vi.fn(() => {
      mockPty = createMockPty()
      return mockPty
    }),
    __getMockPty: () => mockPty,
  }
})

describe('SessionHost', () => {
  let host: SessionHost

  beforeEach(() => {
    host = new SessionHost()
    vi.clearAllMocks()
  })

  it('spawns a session', async () => {
    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    expect(host.has('s1')).toBe(true)
    expect(host.size).toBe(1)
  })

  it('throws on duplicate sessionId', async () => {
    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    await expect(host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')).rejects.toThrow('Session already exists')
  })

  it('lists sessions', async () => {
    await host.spawn('s1', '/home', 80, 24, '/bin/zsh')
    const list = host.list()
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe('s1')
    expect(list[0].cwd).toBe('/home')
  })

  it('emits data events', async () => {
    const dataSpy = vi.fn()
    host.on('data', dataSpy)

    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    const nodePty = await import('node-pty')
    const mockPty = (nodePty as unknown as { __getMockPty: () => ReturnType<typeof createMockPty> }).__getMockPty()
    mockPty._emitData('hello')

    expect(dataSpy).toHaveBeenCalledWith('s1', 'hello')
  })

  it('writes data to session', async () => {
    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    const nodePty = await import('node-pty')
    const mockPty = (nodePty as unknown as { __getMockPty: () => ReturnType<typeof createMockPty> }).__getMockPty()

    host.write('s1', 'input')
    expect(mockPty.write).toHaveBeenCalledWith('input')
  })

  it('resizes session', async () => {
    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    const nodePty = await import('node-pty')
    const mockPty = (nodePty as unknown as { __getMockPty: () => ReturnType<typeof createMockPty> }).__getMockPty()

    host.resize('s1', 120, 40)
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
  })

  it('attaches to session and returns snapshot', async () => {
    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    const nodePty = await import('node-pty')
    const mockPty = (nodePty as unknown as { __getMockPty: () => ReturnType<typeof createMockPty> }).__getMockPty()

    mockPty._emitData('buffered data')
    const snapshot = host.attach('s1')
    expect(snapshot).toBe('buffered data')
  })

  it('returns null for attaching to non-existent session', () => {
    expect(host.attach('nonexistent')).toBeNull()
  })

  it('removes session on exit', async () => {
    const exitSpy = vi.fn()
    host.on('exit', exitSpy)

    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    const nodePty = await import('node-pty')
    const mockPty = (nodePty as unknown as { __getMockPty: () => ReturnType<typeof createMockPty> }).__getMockPty()

    mockPty._emitExit(0)
    expect(host.has('s1')).toBe(false)
    expect(exitSpy).toHaveBeenCalledWith('s1', 0)
  })

  it('generates checkpoint data', async () => {
    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    const nodePty = await import('node-pty')
    const mockPty = (nodePty as unknown as { __getMockPty: () => ReturnType<typeof createMockPty> }).__getMockPty()

    mockPty._emitData('checkpoint data')

    const checkpoints = host.getCheckpoints()
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0].sessionId).toBe('s1')
    expect(checkpoints[0].scrollback).toBe('checkpoint data')
    expect(checkpoints[0].cwd).toBe('/tmp')
  })

  it('kills all sessions', async () => {
    await host.spawn('s1', '/tmp', 80, 24, '/bin/zsh')
    await host.spawn('s2', '/tmp', 80, 24, '/bin/zsh')
    expect(host.size).toBe(2)
    host.killAll()
    expect(host.size).toBe(0)
  })

  it('ignores write/resize to non-existent sessions', () => {
    // Should not throw
    host.write('nope', 'data')
    host.resize('nope', 80, 24)
  })
})
