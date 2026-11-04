/**
 * Unix domain socket server for the PTY daemon.
 *
 * Accepts multiple client connections. Each connection speaks NDJSON.
 * Data events are broadcast to all connected clients that are attached
 * to the emitting session.
 */
import { createServer, type Server, type Socket } from 'net'
import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { DAEMON_FEATURES, DAEMON_VERSION_ENV, PROTOCOL_VERSION, SOCKET_PATH, SOCKET_IS_FILE, encode, decode, type DaemonRequest, type DaemonEvent } from './protocol'
import { defaultShellPath } from '../../lib/shell'
import type { SessionHost } from './sessionHost'
import { SocketBackpressure } from './socketBackpressure'

/** Maximum NDJSON line length (1 MB). Prevents memory exhaustion from malformed input. */
const MAX_LINE_LENGTH = 1_024 * 1_024

// ── Client tracking ──────────────────────────────────────────────────────────

interface ClientState {
  socket: Socket
  /** Incomplete NDJSON line buffer for this connection. */
  lineBuffer: string
  /** Session IDs this client is attached to (for routing data events). */
  attachedSessions: Set<string>
  /** Pause owner for socket backpressure, apart from the client's own flow-control pauses. */
  backpressureOwner: object
}

// ── SocketServer ─────────────────────────────────────────────────────────────

export class SocketServer {
  private server: Server | null = null
  private clients = new Set<ClientState>()
  private onClientConnect?: () => void
  /** Pauses sessions whose output piles up unread in a client's socket. */
  private backpressure = new SocketBackpressure(
    (sessionId, owner) => this.host.pause(sessionId, owner),
    (sessionId, owner) => this.host.resume(sessionId, owner),
  )
  private onClientDisconnect?: () => void

  constructor(
    private host: SessionHost,
    private onShutdownRequested: () => void,
  ) {}

  /** Set callbacks for client connect/disconnect (used by lifecycle auto-shutdown timer). */
  setClientCallbacks(onConnect: () => void, onDisconnect: () => void): void {
    this.onClientConnect = onConnect
    this.onClientDisconnect = onDisconnect
  }

  /** Start listening on the local IPC endpoint (Unix socket or Windows pipe). */
  async start(): Promise<void> {
    // Only POSIX Unix sockets are filesystem entries that need a parent dir and
    // stale-file cleanup. Windows named pipes are kernel objects with no path on
    // disk, and `dirname()` of a pipe ("\\.\pipe") is not a creatable directory.
    if (SOCKET_IS_FILE) {
      mkdirSync(dirname(SOCKET_PATH), { recursive: true, mode: 0o700 })
      if (existsSync(SOCKET_PATH)) {
        unlinkSync(SOCKET_PATH)
      }
    }

    // Wire up session host events to broadcast to attached clients
    this.host.on('data', (sessionId, data, seq) => {
      const line = encode({ type: 'data', sessionId, data, seq })
      for (const client of this.clients) {
        if (client.attachedSessions.has(sessionId) && client.socket.writable) {
          this.backpressure.write(client.backpressureOwner, sessionId, client.socket, line)
        }
      }
    })
    // Agent status goes to every client, attached or not: main shows status for
    // terminals it never attached. Older clients ignore unknown event types.
    this.host.on('status', (event) => {
      const line = encode(event)
      for (const client of this.clients) if (client.socket.writable) client.socket.write(line)
    })
    this.host.on('exit', (sessionId, exitCode, _clean, selfExit) => {
      this.broadcast({ type: 'exit', sessionId, exitCode, selfExit })
      // Remove session from all clients' attached sets
      for (const client of this.clients) {
        client.attachedSessions.delete(sessionId)
      }
    })

    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket))
      this.server.on('error', reject)
      this.server.listen(SOCKET_PATH, () => {
        this.server!.removeListener('error', reject)
        resolve()
      })
    })
  }

  /** Stop accepting connections, close all clients. */
  async close(): Promise<void> {
    for (const client of this.clients) {
      client.socket.destroy()
    }
    this.clients.clear()

    return new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
  }

  get clientCount(): number {
    return this.clients.size
  }

  // ── Connection handling ──────────────────────────────────────────────────

  private handleConnection(socket: Socket): void {
    const client: ClientState = {
      socket,
      lineBuffer: '',
      attachedSessions: new Set(),
      backpressureOwner: {},
    }

    this.clients.add(client)
    this.onClientConnect?.()

    socket.on('data', (chunk: Buffer) => {
      client.lineBuffer += chunk.toString()
      // Guard against memory exhaustion from missing newlines
      if (client.lineBuffer.length > MAX_LINE_LENGTH && !client.lineBuffer.includes('\n')) {
        client.lineBuffer = ''
        return
      }
      this.processLines(client)
    })

    // Detach from all sessions this client was attached to, and let any PTY it
    // paused run again. 'error' is followed by 'close'; run this only once.
    const cleanup = (): void => {
      if (!this.clients.delete(client)) return
      this.host.detachAll(client.attachedSessions)
      this.host.releaseClient(client)
      this.backpressure.release(client.backpressureOwner)
      this.onClientDisconnect?.()
    }
    socket.on('close', cleanup)
    socket.on('error', cleanup)
  }

  private processLines(client: ClientState): void {
    let newlineIdx: number
    while ((newlineIdx = client.lineBuffer.indexOf('\n')) !== -1) {
      const line = client.lineBuffer.slice(0, newlineIdx)
      client.lineBuffer = client.lineBuffer.slice(newlineIdx + 1)

      const msg = decode(line)
      if (msg && 'id' in msg) {
        this.handleRequest(client, msg as DaemonRequest)
      }
    }
  }

  // ── Request dispatch ───────────────────────────────────────────────────

  private async handleRequest(client: ClientState, req: DaemonRequest): Promise<void> {
    try {
      switch (req.type) {
        case 'spawn':
          await this.host.spawn(
            req.sessionId, req.cwd, req.cols, req.rows,
            req.shell || process.env.SHELL || defaultShellPath(),
            req.env,
            req.bufferMaxLength,
            { scrollback: req.scrollback, visibleBy: req.visible ? client : undefined },
          )
          client.attachedSessions.add(req.sessionId)
          this.sendResponse(client, { id: req.id, type: 'ok' })
          break

        case 'attach': {
          const snapshot = this.host.attach(req.sessionId)
          if (snapshot === null) {
            this.sendResponse(client, { id: req.id, type: 'error', message: `Session not found: ${req.sessionId}` })
          } else {
            client.attachedSessions.add(req.sessionId)
            if (req.visible !== undefined) this.host.setVisible(req.sessionId, client, req.visible, { snapshotFollows: req.snapshotFollows === true })
            this.sendResponse(client, { id: req.id, type: 'ok', data: { snapshot, ...this.host.coldRestoreInfo(req.sessionId) } })
          }
          break
        }

        case 'write':
          this.host.write(req.sessionId, req.data)
          // Fire-and-forget: no response
          break

        case 'resize':
          this.host.resize(req.sessionId, req.cols, req.rows)
          // Fire-and-forget: no response
          break

        case 'kill':
          this.host.kill(req.sessionId)
          client.attachedSessions.delete(req.sessionId)
          this.sendResponse(client, { id: req.id, type: 'ok' })
          break

        case 'snapshot': {
          const data = this.host.snapshot(req.sessionId)
          if (data === null) {
            this.sendResponse(client, { id: req.id, type: 'error', message: `Session not found: ${req.sessionId}` })
          } else {
            this.sendResponse(client, { id: req.id, type: 'ok', data: { snapshot: data } })
          }
          break
        }

        case 'list': {
          const sessions = this.host.list()
          this.sendResponse(client, { id: req.id, type: 'ok', data: { sessions } })
          break
        }

        case 'setBufferMaxLength':
          this.host.setBufferMaxLength(req.maxLength, req.scrollback)
          this.sendResponse(client, { id: req.id, type: 'ok' })
          break

        case 'setMetadata':
          this.host.setMetadata(req.sessionId, req.metadata)
          this.sendResponse(client, { id: req.id, type: 'ok' })
          break

        case 'consumeColdRestore':
          this.sendResponse(client, { id: req.id, type: 'ok', data: { claimed: this.host.consumeColdRestore(req.sessionId) } })
          break

        case 'hello':
          this.sendResponse(client, {
            id: req.id,
            type: 'ok',
            data: {
              protocol: PROTOCOL_VERSION,
              version: process.env[DAEMON_VERSION_ENV] || undefined,
              sessionCount: this.host.size,
              features: [...DAEMON_FEATURES],
            },
          })
          break

        case 'pause':
          this.host.pause(req.sessionId, client)
          // Fire-and-forget: no response
          break

        case 'resume':
          this.host.resume(req.sessionId, client)
          // Fire-and-forget: no response
          break

        case 'headlessSnapshot': {
          const snap = await this.host.headlessSnapshot(req.sessionId, client)
          if (snap === null) this.sendResponse(client, { id: req.id, type: 'error', message: `Session not found: ${req.sessionId}` })
          else this.sendResponse(client, { id: req.id, type: 'ok', data: snap })
          break
        }

        case 'setColors':
          this.host.setColors(req.colors ?? {})
          this.sendResponse(client, { id: req.id, type: 'ok' })
          break

        case 'setVisible': {
          const seq = this.host.setVisible(req.sessionId, client, req.visible === true, {
            snapshotFollows: req.snapshotFollows === true,
            ...(typeof req.deliveredThrough === 'number' ? { deliveredThrough: req.deliveredThrough } : {}),
          })
          this.sendResponse(client, { id: req.id, type: 'ok', data: { seq } })
          break
        }

        case 'ping':
          this.sendResponse(client, { id: req.id, type: 'ok' })
          break

        case 'shutdown':
          this.sendResponse(client, { id: req.id, type: 'ok' })
          this.onShutdownRequested()
          break

        default: {
          const exhaustive: never = req
          this.sendResponse(client, { id: (exhaustive as DaemonRequest).id, type: 'error', message: `Unknown request type` })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.sendResponse(client, { id: req.id, type: 'error', message })
    }
  }

  // ── I/O helpers ────────────────────────────────────────────────────────

  private sendResponse(client: ClientState, msg: { id: string; type: 'ok' | 'error'; data?: unknown; message?: string }): void {
    if (!client.socket.writable) return
    client.socket.write(encode(msg as import('./protocol').DaemonMessage))
  }

  /** Broadcast an event to all clients attached to the relevant session. */
  private broadcast(event: DaemonEvent): void {
    const line = encode(event)
    for (const client of this.clients) {
      if (client.attachedSessions.has(event.sessionId) && client.socket.writable) {
        client.socket.write(line)
      }
    }
  }
}
