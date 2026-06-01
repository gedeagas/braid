/**
 * DaemonClient - connects to the PTY daemon via Unix domain socket.
 *
 * Used by the Electron main process to communicate with the daemon.
 * Handles request-response correlation, event routing, and auto-reconnect.
 */
import { connect, type Socket } from 'net'
import { EventEmitter } from 'events'
import { SOCKET_PATH, encode, decode, type DaemonMessage, type DaemonRequest, type DaemonResponse, type DataEvent, type ExitEvent } from './protocol'
import type { DaemonSessionMetadata, SessionInfo } from './types'

const REQUEST_TIMEOUT_MS = 10_000
const RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_ATTEMPTS = 5

interface PendingRequest {
  resolve: (data?: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface DaemonClientEvents {
  data: [sessionId: string, data: string]
  exit: [sessionId: string, exitCode: number]
  connected: []
  disconnected: []
}

export class DaemonClient extends EventEmitter<DaemonClientEvents> {
  private socket: Socket | null = null
  private lineBuffer = ''
  private pending = new Map<string, PendingRequest>()
  private requestCounter = 0
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _connected = false
  private _closed = false
  /** Session IDs this client is attached to. Re-attached on reconnect. */
  private attachedSessions = new Set<string>()

  get connected(): boolean {
    return this._connected
  }

  /** Connect to the daemon socket. */
  async connect(): Promise<void> {
    if (this._closed) return
    return new Promise<void>((resolve, reject) => {
      this.socket = connect(SOCKET_PATH)

      this.socket.on('connect', () => {
        this._connected = true
        this.reconnectAttempts = 0
        // Re-attach to all previously attached sessions so data events resume
        this.reattachAll()
        this.emit('connected')
        resolve()
      })

      this.socket.on('data', (chunk: Buffer) => {
        this.lineBuffer += chunk.toString()
        this.processLines()
      })

      this.socket.on('close', () => {
        this._connected = false
        this.rejectAllPending('Connection closed')
        this.emit('disconnected')
        this.scheduleReconnect()
      })

      this.socket.on('error', (err) => {
        if (!this._connected) {
          reject(err)
          return
        }
        this._connected = false
        this.rejectAllPending('Connection error')
        this.emit('disconnected')
        this.scheduleReconnect()
      })
    })
  }

  /** Disconnect from the daemon (without killing it). */
  disconnect(): void {
    this._closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.rejectAllPending('Client disconnected')
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this._connected = false
  }

  // ── High-level operations ──────────────────────────────────────────────

  async spawn(sessionId: string, cwd: string, cols: number, rows: number, shell: string, env?: Record<string, string>, bufferMaxLength?: number): Promise<void> {
    await this.request({ type: 'spawn', sessionId, cwd, cols, rows, shell, env, bufferMaxLength } as Omit<DaemonRequest, 'id'> & { type: 'spawn' })
    this.attachedSessions.add(sessionId)
  }

  async attach(sessionId: string): Promise<{ snapshot: string }> {
    const result = await this.request({ type: 'attach', sessionId } as Omit<DaemonRequest, 'id'> & { type: 'attach' })
    this.attachedSessions.add(sessionId)
    return result as { snapshot: string }
  }

  write(sessionId: string, data: string): void {
    // Fire-and-forget
    this.send({ type: 'write', sessionId, data } as Omit<DaemonRequest, 'id'> & { type: 'write' })
  }

  resize(sessionId: string, cols: number, rows: number): void {
    // Fire-and-forget
    this.send({ type: 'resize', sessionId, cols, rows } as Omit<DaemonRequest, 'id'> & { type: 'resize' })
  }

  async kill(sessionId: string): Promise<void> {
    this.attachedSessions.delete(sessionId)
    await this.request({ type: 'kill', sessionId } as Omit<DaemonRequest, 'id'> & { type: 'kill' })
  }

  async snapshot(sessionId: string): Promise<string> {
    const result = await this.request({ type: 'snapshot', sessionId } as Omit<DaemonRequest, 'id'> & { type: 'snapshot' })
    return (result as { snapshot: string }).snapshot
  }

  async list(): Promise<SessionInfo[]> {
    const result = await this.request({ type: 'list' } as Omit<DaemonRequest, 'id'> & { type: 'list' })
    return (result as { sessions: SessionInfo[] }).sessions
  }

  async setBufferMaxLength(maxLength: number): Promise<void> {
    await this.request({ type: 'setBufferMaxLength', maxLength } as Omit<DaemonRequest, 'id'> & { type: 'setBufferMaxLength' })
  }

  /** Persist big-terminal display metadata on the daemon session (fire-and-forget). */
  setMetadata(sessionId: string, metadata: DaemonSessionMetadata): void {
    this.send({ type: 'setMetadata', sessionId, metadata } as Omit<DaemonRequest, 'id'> & { type: 'setMetadata' })
  }

  async ping(): Promise<void> {
    await this.request({ type: 'ping' } as Omit<DaemonRequest, 'id'> & { type: 'ping' })
  }

  async shutdown(): Promise<void> {
    await this.request({ type: 'shutdown' } as Omit<DaemonRequest, 'id'> & { type: 'shutdown' })
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private nextId(): string {
    return `req-${++this.requestCounter}`
  }

  /** Send a fire-and-forget message. */
  private send(msg: Record<string, unknown>): void {
    if (!this.socket?.writable) return
    const id = this.nextId()
    const full = { ...msg, id }
    this.socket.write(encode(full as DaemonMessage))
  }

  /** Send a request and await the correlated response. */
  private request(msg: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.writable) {
        reject(new Error('Not connected to daemon'))
        return
      }

      const id = this.nextId()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timed out: ${msg.type}`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      const full = { ...msg, id }
      this.socket.write(encode(full as DaemonMessage))
    })
  }

  private processLines(): void {
    let idx: number
    while ((idx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, idx)
      this.lineBuffer = this.lineBuffer.slice(idx + 1)

      const msg = decode(line)
      if (!msg) continue

      if ('id' in msg && (msg.type === 'ok' || msg.type === 'error')) {
        // This is a response to a request
        const resp = msg as DaemonResponse
        const pending = this.pending.get(resp.id)
        if (pending) {
          this.pending.delete(resp.id)
          clearTimeout(pending.timer)
          if (resp.type === 'error') {
            pending.reject(new Error(resp.message))
          } else {
            pending.resolve(resp.data)
          }
        }
      } else if (msg.type === 'data') {
        const event = msg as DataEvent
        this.emit('data', event.sessionId, event.data)
      } else if (msg.type === 'exit') {
        const event = msg as ExitEvent
        this.attachedSessions.delete(event.sessionId)
        this.emit('exit', event.sessionId, event.exitCode)
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
      this.pending.delete(id)
    }
  }

  /** Re-attach to all tracked sessions after a reconnect. */
  private reattachAll(): void {
    for (const sessionId of this.attachedSessions) {
      // Fire-and-forget: we don't need the snapshot here, just re-subscribe to data events
      this.send({ type: 'attach', sessionId })
    }
  }

  private scheduleReconnect(): void {
    if (this._closed) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++
      try {
        await this.connect()
      } catch {
        // Will retry via the close/error handler
      }
    }, RECONNECT_DELAY_MS)
  }
}
