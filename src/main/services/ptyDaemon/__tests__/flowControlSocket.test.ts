import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'net'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Socket-level tests for daemon flow control and feature detection: a real
// SocketServer + DaemonClient over a temp socket, with node-pty mocked.

const TEST_DIR = join(tmpdir(), `braid-flow-${process.pid}`)
const TEST_SOCKET = join(TEST_DIR, 'pty-v1.sock')

vi.mock('../protocol', async () => {
  const actual = await vi.importActual<typeof import('../protocol')>('../protocol')
  return { ...actual, DAEMON_DIR: TEST_DIR, SOCKET_PATH: TEST_SOCKET }
})

interface MockPty {
  onData: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  emit: (data: string) => void
}
const ptys: MockPty[] = []

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const data: Array<(d: string) => void> = []
    const pty: MockPty = {
      onData: vi.fn((cb) => { data.push(cb) }),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      emit: (d) => { for (const cb of data) cb(d) },
    }
    ptys.push(pty)
    return pty
  }),
}))

const { SessionHost } = await import('../sessionHost')
const { SocketServer } = await import('../socketServer')
const { DaemonClient } = await import('../client')
const { DAEMON_FEATURES, PROTOCOL_VERSION } = await import('../protocol')

const waitFor = async (cond: () => boolean, ms = 2_000): Promise<void> => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('daemon flow control over the socket', () => {
  let host: InstanceType<typeof SessionHost>
  let server: InstanceType<typeof SocketServer>
  let client: InstanceType<typeof DaemonClient>

  beforeEach(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    ptys.length = 0
    host = new SessionHost()
    server = new SocketServer(host, () => {})
    await server.start()
    client = new DaemonClient()
    await client.connect()
  })

  afterEach(async () => {
    client.disconnect()
    await server.close()
    host.dispose()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('lists its features in hello, without changing the protocol version', async () => {
    const hello = await client.hello()
    expect(PROTOCOL_VERSION).toBe(1)
    expect(hello.features).toEqual([...DAEMON_FEATURES])
    expect(client.hasFeature('flow-control')).toBe(true)
  })

  it('pauses and resumes the PTY on request', async () => {
    await client.hello()
    await client.spawn('s1', TEST_DIR, 80, 24, '/bin/sh')
    client.pause('s1')
    await waitFor(() => ptys[0].pause.mock.calls.length === 1)
    client.resume('s1')
    await waitFor(() => ptys[0].resume.mock.calls.length === 1)
  })

  it('resumes every session a client paused when it disconnects', async () => {
    await client.hello()
    await client.spawn('s1', TEST_DIR, 80, 24, '/bin/sh')
    client.pause('s1')
    await waitFor(() => ptys[0].pause.mock.calls.length === 1)
    client.disconnect()
    await waitFor(() => ptys[0].resume.mock.calls.length === 1)
  })
})

describe('talking to a daemon from before flow control (app update)', () => {
  let legacy: Server
  const received: Array<{ type: string }> = []
  const sockets = new Set<Socket>()

  beforeEach(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    received.length = 0
    // Minimal stand-in for today's daemon: hello has no `features`, unknown
    // request types get "Unknown request type".
    legacy = createServer((socket: Socket) => {
      sockets.add(socket)
      let buf = ''
      socket.on('data', (chunk) => {
        buf += chunk.toString()
        let i: number
        while ((i = buf.indexOf('\n')) !== -1) {
          const msg = JSON.parse(buf.slice(0, i)) as { id: string; type: string }
          buf = buf.slice(i + 1)
          received.push(msg)
          const reply = msg.type === 'hello'
            ? { id: msg.id, type: 'ok', data: { protocol: 1, version: '26.3.3', sessionCount: 2 } }
            : ['write', 'resize'].includes(msg.type)
              ? null
              : { id: msg.id, type: 'error', message: 'Unknown request type' }
          if (reply) socket.write(JSON.stringify(reply) + '\n')
        }
      })
    })
    await new Promise<void>((r) => legacy.listen(TEST_SOCKET, () => r()))
  })

  afterEach(async () => {
    for (const s of sockets) s.destroy()
    sockets.clear()
    await new Promise<void>((r) => legacy.close(() => r()))
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('treats a hello without features as a daemon with no features and never sends pause/resume', async () => {
    const client = new DaemonClient()
    await client.connect()
    const hello = await client.hello()
    expect(hello.features).toEqual([])
    expect(client.hasFeature('flow-control')).toBe(false)
    client.pause('s1')
    client.resume('s1')
    client.write('s1', 'x')
    await waitFor(() => received.some((m) => m.type === 'write'))
    // Only requests every daemon understands went out (the client says hello
    // by itself on connect, and the test asks again).
    expect(received.map((m) => m.type).filter((t) => t !== 'hello')).toEqual(['write'])
    client.disconnect()
  })
})
