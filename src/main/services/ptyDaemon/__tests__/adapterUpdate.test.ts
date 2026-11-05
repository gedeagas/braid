import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'net'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The real main-process adapter after an app update, against (1) a daemon from
// before this change (hello without features) and (2) this build's daemon.

const TEST_DIR = join(tmpdir(), `braid-adapter-${process.pid}`)
const TEST_SOCKET = join(TEST_DIR, 'pty-v1.sock')
const sent: Array<{ channel: string; args: unknown[] }> = []

vi.mock('../protocol', async () => {
  const actual = await vi.importActual<typeof import('../protocol')>('../protocol')
  return { ...actual, DAEMON_DIR: TEST_DIR, SOCKET_PATH: TEST_SOCKET }
})
vi.mock('electron', () => ({
  app: { getVersion: () => '26.4.0' },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }) } }] },
}))
vi.mock('../../../ipc', () => ({ mainSettings: { terminalShell: '/bin/sh', terminalScrollback: 1000 } }))
vi.mock('../../agentHookServer', () => ({ getHookServerPort: () => 0, getHookServerToken: () => '' }))
// Connect without spawning a real daemon process.
vi.mock('../daemonLauncher', () => ({
  connectToDaemon: async (client: { connect(): Promise<void>; hello(): Promise<unknown> }) => { await client.connect(); await client.hello() },
}))

interface MockPty { emit: (d: string) => void; exit: (code: number) => void; write: ReturnType<typeof vi.fn> }
const ptys: MockPty[] = []
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const data: Array<(d: string) => void> = []
    const exits: Array<(e: { exitCode: number }) => void> = []
    const pty = {
      onData: vi.fn((cb: (d: string) => void) => { data.push(cb) }), onExit: vi.fn((cb: (e: { exitCode: number }) => void) => { exits.push(cb) }),
      write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      emit: (d: string) => { for (const cb of data) cb(d) },
      exit: (exitCode: number) => { for (const cb of exits) cb({ exitCode }) },
    }
    ptys.push(pty)
    return pty
  }),
}))

const { PtyDaemonAdapter } = await import('../adapter')
const { SessionHost } = await import('../sessionHost')
const { SocketServer } = await import('../socketServer')

const waitFor = async (cond: () => boolean, ms = 2_000): Promise<void> => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}
const dataFor = (id: string) => sent.filter((s) => s.channel === 'pty:data' && s.args[0] === id).map((s) => s.args[1]).join('')

describe('new main + daemon from before this change (legacy mode)', () => {
  let legacy: Server
  const sockets = new Set<Socket>()
  const received: string[] = []

  beforeEach(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    sent.length = 0
    received.length = 0
    legacy = createServer((socket) => {
      sockets.add(socket)
      let buf = ''
      socket.on('data', (chunk) => {
        buf += chunk.toString()
        let i: number
        while ((i = buf.indexOf('\n')) !== -1) {
          const msg = JSON.parse(buf.slice(0, i)) as { id: string; type: string; sessionId?: string }
          buf = buf.slice(i + 1)
          received.push(msg.type)
          const ok = (data?: unknown) => socket.write(JSON.stringify({ id: msg.id, type: 'ok', data }) + '\n')
          switch (msg.type) {
            case 'hello': ok({ protocol: 1, version: '26.3.3', sessionCount: 1 }); break
            case 'list': ok({ sessions: [{ sessionId: 'bt-1-1', cwd: TEST_DIR, cols: 80, rows: 24, createdAt: 1, attachedClients: 0, metadata: { label: 'A' } }] }); break
            case 'attach': ok({ snapshot: 'raw ring buffer' }); break
            case 'write': case 'resize': break
            default: socket.write(JSON.stringify({ id: msg.id, type: 'error', message: 'Unknown request type' }) + '\n')
          }
        }
      })
    })
    await new Promise<void>((r) => legacy.listen(TEST_SOCKET, () => r()))
  })

  afterEach(async () => {
    for (const s of sockets) s.destroy()
    await new Promise<void>((r) => legacy.close(() => r()))
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('reattaches with the raw snapshot, keeps delivering hidden terminals, and never sends new request types', async () => {
    const adapter = new PtyDaemonAdapter()
    expect(await adapter.getFeatures()).toEqual([])
    const result = await adapter.reattach('bt-1-1')
    expect(result?.snapshot).toBe('raw ring buffer')
    expect(await adapter.headlessSnapshot('bt-1-1')).toBeNull()

    adapter.setVisible('bt-1-1', false)
    // A flood that would pause the producer on a capable daemon.
    const socket = [...sockets][0]
    for (let i = 0; i < 40; i++) socket.write(JSON.stringify({ type: 'data', sessionId: 'bt-1-1', data: 'x'.repeat(16 * 1024) }) + '\n')
    await waitFor(() => dataFor('bt-1-1').length > 0)
    adapter.setTerminalColors({ background: '#000000' })
    adapter.setDeliveryInterest('bt-1-1', true)
    adapter.snapshotApplied('bt-1-1', 5)
    adapter.write('bt-1-1', 'ls\n')
    await new Promise((r) => setTimeout(r, 50))

    expect(dataFor('bt-1-1').length).toBeGreaterThan(0)
    expect(new Set(received)).toEqual(new Set(['hello', 'list', 'attach', 'write']))
    adapter.disconnectFromDaemon()
  })
})

describe('new main + this build\'s daemon (offload)', () => {
  let host: InstanceType<typeof SessionHost>
  let server: InstanceType<typeof SocketServer>

  beforeEach(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    sent.length = 0
    ptys.length = 0
    host = new SessionHost()
    server = new SocketServer(host, () => {})
    await server.start()
  })

  afterEach(async () => {
    await server.close()
    host.dispose()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('sends no output for a hidden terminal and hands off at the snapshot seq without gaps or duplicates', async () => {
    const adapter = new PtyDaemonAdapter()
    const id = await adapter.spawn(TEST_DIR, { BRAID_TERMINAL_ID: 'bt-2-2' })
    expect(await adapter.getFeatures()).toContain('headless-snapshot')
    ptys[0].emit('visible ')
    await waitFor(() => dataFor(id) === 'visible ')

    adapter.setVisible(id, false)
    await new Promise((r) => setTimeout(r, 20))
    ptys[0].emit('[hidden-1]')
    ptys[0].emit('[hidden-2]')
    await new Promise((r) => setTimeout(r, 50))
    expect(dataFor(id)).toBe('visible ')

    adapter.setVisible(id, true)
    const snapPromise = adapter.headlessSnapshot(id)
    const snap = await snapPromise
    if (!snap || snap.upToDate) throw new Error('expected a snapshot')
    expect(snap.data).toContain('[hidden-1][hidden-2]')
    ptys[0].emit('[after]')
    await new Promise((r) => setTimeout(r, 50))
    expect(dataFor(id)).toBe('visible ') // held until the renderer confirms
    adapter.snapshotApplied(id, snap.seq)
    await waitFor(() => dataFor(id) === 'visible [after]')

    // Shown all along since: no snapshot needed.
    expect(await adapter.headlessSnapshot(id)).toEqual({ upToDate: true })
    adapter.disconnectFromDaemon()
  })

  it('keeps the final screen of a terminal that exits while hidden, for its next reveal', async () => {
    const adapter = new PtyDaemonAdapter()
    const id = await adapter.spawn(TEST_DIR, { BRAID_TERMINAL_ID: 'bt-5-5' })
    expect(await adapter.getFeatures()).toContain('headless-snapshot')
    adapter.setVisible(id, false)
    await new Promise((r) => setTimeout(r, 20))
    ptys[0].emit('result')
    ptys[0].exit(0)
    await waitFor(() => sent.some((s) => s.channel === 'pty:exit' && s.args[0] === id))
    expect(dataFor(id)).toBe('')

    const snap = await adapter.headlessSnapshot(id)
    if (!snap || snap.upToDate) throw new Error('expected the final snapshot')
    expect(snap.exited).toBe(true)
    expect(snap.data).toContain('result')
    expect(await adapter.headlessSnapshot(id)).toEqual({ upToDate: true }) // handed out once
    adapter.disconnectFromDaemon()
  })

  it('answers a query sent right as a terminal is shown exactly once: the daemon, with the renderer told not to', async () => {
    const adapter = new PtyDaemonAdapter()
    const id = await adapter.spawn(TEST_DIR, { BRAID_TERMINAL_ID: 'bt-4-4' })
    await adapter.getFeatures()
    adapter.setVisible(id, false)
    await new Promise((r) => setTimeout(r, 20))
    adapter.setVisible(id, true)
    ptys[0].emit('\x1b[c') // numbered before the daemon hears of the show
    await waitFor(() => dataFor(id).includes('\x1b[c'))
    await waitFor(() => ptys[0].write.mock.calls.length === 1)
    const delivery = sent.find((s) => s.channel === 'pty:data' && s.args[0] === id && String(s.args[1]).includes('\x1b[c'))
    expect(delivery?.args[2]).toBe(true) // no-reply: the renderer must not answer it too
    ptys[0].emit('\x1b[c') // after the show: the renderer's, delivered normally
    await waitFor(() => sent.filter((s) => s.channel === 'pty:data' && s.args[0] === id).length === 2)
    expect(sent.filter((s) => s.channel === 'pty:data' && s.args[0] === id).at(-1)?.args[2]).toBeUndefined()
    await new Promise((r) => setTimeout(r, 30))
    expect(ptys[0].write).toHaveBeenCalledTimes(1)
    adapter.disconnectFromDaemon()
  })

  it('forwards agent status detected by the daemon to the renderer', async () => {
    const adapter = new PtyDaemonAdapter()
    await adapter.spawn(TEST_DIR, { BRAID_TERMINAL_ID: 'bt-3-3' })
    ptys[0].emit('\x1b]0;⠋ Claude Code\x07')
    await waitFor(() => sent.some((s) => s.channel === 'pty:agentStatus'))
    expect(sent.find((s) => s.channel === 'pty:agentStatus')?.args[0]).toMatchObject({ terminalId: 'bt-3-3', kind: 'title', status: { state: 'working', agentType: 'claude' }, replayed: false })
    adapter.disconnectFromDaemon()
  })
})
