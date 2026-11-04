import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The daemon's headless terminal over a real socket: seq numbering, screen
// snapshots, who answers terminal queries, status events, and cold restore
// from a checkpoint written by today's daemon.

const TEST_DIR = join(tmpdir(), `braid-headless-${process.pid}`)
const TEST_SOCKET = join(TEST_DIR, 'pty-v1.sock')

vi.mock('../protocol', async () => {
  const actual = await vi.importActual<typeof import('../protocol')>('../protocol')
  return { ...actual, DAEMON_DIR: TEST_DIR, SOCKET_PATH: TEST_SOCKET }
})

interface MockPty { write: ReturnType<typeof vi.fn>; emit: (d: string) => void }
const ptys: MockPty[] = []
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const data: Array<(d: string) => void> = []
    const pty = {
      onData: vi.fn((cb: (d: string) => void) => { data.push(cb) }),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      process: 'zsh',
      emit: (d: string) => { for (const cb of data) cb(d) },
    }
    ptys.push(pty)
    return pty
  }),
}))

const { SessionHost } = await import('../sessionHost')
const { SocketServer } = await import('../socketServer')
const { DaemonClient } = await import('../client')

const waitFor = async (cond: () => boolean, ms = 2_000): Promise<void> => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}
const settle = () => new Promise((r) => setTimeout(r, 30))
const DA1_REPLY = /\x1b\[\?[\d;]+c/

describe('headless daemon over the socket', () => {
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
    await client.hello()
  })

  afterEach(async () => {
    client.disconnect()
    await server.close()
    host.dispose()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('lists headless-snapshot and status-events', () => {
    expect(client.hasFeature('headless-snapshot')).toBe(true)
    expect(client.hasFeature('status-events')).toBe(true)
  })

  it('numbers output, and a snapshot covers exactly the output up to its seq', async () => {
    const seen: Array<[string, number]> = []
    client.on('data', (_id, data, seq) => seen.push([data, seq]))
    await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: true })
    ptys[0].emit('one ')
    ptys[0].emit('two ')
    await waitFor(() => seen.length === 2)
    const snap = await client.headlessSnapshot('s1')
    ptys[0].emit('three')
    await waitFor(() => seen.length === 3)
    expect(seen.map(([, seq]) => seq)).toEqual([1, 2, 3])
    expect(snap?.seq).toBe(2)
    expect(snap?.data).toContain('one two')
    expect(snap?.data).not.toContain('three')
  })

  it('answers queries only while no client shows the session', async () => {
    await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: true })
    ptys[0].emit('\x1b[c')
    await settle()
    expect(ptys[0].write).not.toHaveBeenCalled()

    await client.setVisible('s1', false)
    ptys[0].emit('\x1b[c')
    await client.headlessSnapshot('s1')
    await waitFor(() => ptys[0].write.mock.calls.length === 1)
    expect(ptys[0].write.mock.calls[0][0]).toMatch(DA1_REPLY)

    await client.setVisible('s1', true)
    ptys[0].emit('\x1b[c')
    await settle()
    expect(ptys[0].write).toHaveBeenCalledTimes(1)
  })

  it('answers the queries a snapshot covers, and none after it, when a client shows the session', async () => {
    await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: false })
    await client.setVisible('s1', true)
    ptys[0].emit('\x1b[?2026h') // an open frame: the snapshot waits for it
    const snap = client.headlessSnapshot('s1')
    await settle()
    ptys[0].emit('\x1b[c') // inside the snapshot: the renderer never sees it
    ptys[0].emit('\x1b[?2026l')
    const { seq } = (await snap)!
    expect(seq).toBe(3)
    await waitFor(() => ptys[0].write.mock.calls.length === 1)
    expect(ptys[0].write.mock.calls[0][0]).toMatch(DA1_REPLY)
    ptys[0].emit('\x1b[c') // after the snapshot: the renderer answers it
    await settle()
    expect(ptys[0].write).toHaveBeenCalledTimes(1)
  })

  it('keeps answering from setVisible until the snapshot that follows it is taken', async () => {
    await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: false })
    await client.setVisible('s1', true, { snapshotFollows: true })
    ptys[0].emit('\x1b[c') // shown, but before the snapshot request: the snapshot covers it
    await settle()
    await waitFor(() => ptys[0].write.mock.calls.length === 1)
    await client.headlessSnapshot('s1')
    ptys[0].emit('\x1b[c') // after the snapshot: the renderer answers it
    await settle()
    expect(ptys[0].write).toHaveBeenCalledTimes(1)
  })

  it('returns the seq it answers through when shown, and answers exactly those', async () => {
    await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: false })
    ptys[0].emit('\x1b[c') // seq 1, hidden: the daemon answers it however late it is parsed
    const seq = (await client.setVisible('s1', true))?.seq
    expect(seq).toBe(1)
    await waitFor(() => ptys[0].write.mock.calls.length === 1)
    ptys[0].emit('\x1b[c') // seq 2: the renderer's
    await settle()
    expect(ptys[0].write).toHaveBeenCalledTimes(1)
  })

  it('stops a snapshot handoff that never gets its snapshot', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    try {
      await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: false })
      await client.setVisible('s1', true, { snapshotFollows: true })
      vi.advanceTimersByTime(6_000)
      ptys[0].emit('\x1b[c')
      await settle()
      expect(ptys[0].write).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes over answering when the showing client disconnects', async () => {
    await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: true })
    client.disconnect()
    await settle()
    ptys[0].emit('\x1b[c')
    const probe = new DaemonClient()
    await probe.connect()
    await probe.hello()
    await probe.headlessSnapshot('s1')
    await waitFor(() => ptys[0].write.mock.calls.length === 1)
    probe.disconnect()
  })

  it('sends status events to every client, attached or not', async () => {
    const other = new DaemonClient()
    await other.connect()
    const events: unknown[] = []
    other.on('status', (e) => events.push(e))
    await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: true })
    ptys[0].emit('\x1b]9999;{"state":"working","agentType":"claude","toolName":"Edit"}\x07')
    await waitFor(() => events.length === 1)
    expect(events[0]).toMatchObject({ type: 'status', sessionId: 's1', kind: 'osc', replayed: false, status: { state: 'working', toolName: 'Edit' } })
    const sessions = await client.list()
    expect(sessions[0].agentStatus).toMatchObject({ state: 'working', source: 'hook' })
    other.disconnect()
  })

  it('cold-restores from a checkpoint written by today\'s daemon, seeding the screen without answering its queries', async () => {
    const events: Array<{ replayed: boolean }> = []
    client.on('status', (e) => events.push(e))
    // Exactly the fields today's daemon writes - nothing new.
    await host.restore({
      sessionId: 'bt-1-1', cwd: TEST_DIR, cols: 40, rows: 5,
      scrollback: 'restored history \x1b[c\x1b]9999;{"state":"done"}\x07',
      createdAt: 1, checkpointedAt: 2, metadata: { label: 'Claude', agentId: 'claude' },
      env: { BRAID_TERMINAL_ID: 'bt-1-1' }, foreground: 'command',
    }, '/bin/sh')
    await client.attach('bt-1-1')
    const snap = await client.headlessSnapshot('bt-1-1')
    expect(snap?.data).toContain('restored history')
    expect(snap?.seq).toBe(0)
    await settle()
    expect(ptys[0].write).not.toHaveBeenCalled()
    await waitFor(() => events.length === 1)
    expect(events[0].replayed).toBe(true)
  })

  it('answers a hidden terminal\'s background colour query with the colours the renderer pushed', async () => {
    client.setColors({ foreground: '#e6edf3', background: 'rgb(13, 17, 23)', cursor: '#58a6ff' })
    await client.spawn('s1', TEST_DIR, 40, 5, '/bin/sh', undefined, undefined, { visible: false })
    ptys[0].emit('\x1b]11;?\x07')
    await client.headlessSnapshot('s1')
    await waitFor(() => ptys[0].write.mock.calls.length === 1)
    expect(ptys[0].write.mock.calls[0][0]).toBe('\x1b]11;rgb:0d0d/1111/1717\x1b\\')
  })
})
