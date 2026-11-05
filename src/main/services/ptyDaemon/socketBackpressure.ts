// Backpressure on the daemon -> client socket. When a client (main) stops
// reading - its event loop is busy, or it stalled - socket writes pile up in
// the daemon's memory. Count bytes written but not yet flushed, per client and
// session; above the high mark, pause the sessions producing most of it
// (through the PauseValve, so the 10s safety valve applies), and resume them
// once the client has drained below the low mark.

export interface SocketLike {
  write(line: string, cb?: () => void): boolean
}

export interface SocketBackpressureLimits {
  /** Pressure starts above this many unflushed bytes for one client... */
  high: number
  /** ...and ends below this. */
  low: number
  /** While pressured, a session with this much unflushed output is paused... */
  sessionHigh: number
  /** ...until it is down to this. */
  sessionLow: number
}

export const DEFAULT_SOCKET_BACKPRESSURE: SocketBackpressureLimits = {
  high: 4 * 1024 * 1024,
  low: 1024 * 1024,
  sessionHigh: 64 * 1024,
  sessionLow: 32 * 1024,
}

interface ClientBacklog {
  total: number
  bySession: Map<string, number>
  pressured: boolean
  paused: Set<string>
}

export class SocketBackpressure {
  private clients = new Map<unknown, ClientBacklog>()

  constructor(
    private pause: (sessionId: string, clientId: unknown) => void,
    private resume: (sessionId: string, clientId: unknown) => void,
    private limits: SocketBackpressureLimits = DEFAULT_SOCKET_BACKPRESSURE,
  ) {}

  write(clientId: unknown, sessionId: string, socket: SocketLike, line: string): void {
    let c = this.clients.get(clientId)
    if (!c) {
      c = { total: 0, bySession: new Map(), pressured: false, paused: new Set() }
      this.clients.set(clientId, c)
    }
    const bytes = Buffer.byteLength(line)
    const backlog = c
    backlog.total += bytes
    backlog.bySession.set(sessionId, (backlog.bySession.get(sessionId) ?? 0) + bytes)
    // Output from a session we paused means the safety valve resumed it while
    // the client is still behind: pause it again.
    if (backlog.pressured && backlog.paused.has(sessionId)) this.pause(sessionId, clientId)
    this.refresh(clientId, backlog)
    socket.write(line, () => {
      // A disconnected client's callbacks must not touch a new connection's counts.
      if (this.clients.get(clientId) !== backlog) return
      backlog.total -= bytes
      const left = (backlog.bySession.get(sessionId) ?? 0) - bytes
      if (left > 0) backlog.bySession.set(sessionId, left)
      else backlog.bySession.delete(sessionId)
      this.refresh(clientId, backlog)
    })
  }

  /** The client disconnected: resume what it held back and forget it. */
  release(clientId: unknown): void {
    const c = this.clients.get(clientId)
    if (!c) return
    this.clients.delete(clientId)
    for (const sessionId of c.paused) this.resume(sessionId, clientId)
  }

  private refresh(clientId: unknown, c: ClientBacklog): void {
    const { high, low, sessionHigh, sessionLow } = this.limits
    if (c.total > high) c.pressured = true
    else if (c.total < low) c.pressured = false
    for (const sessionId of [...c.paused]) {
      if (!c.pressured || (c.bySession.get(sessionId) ?? 0) <= sessionLow) {
        c.paused.delete(sessionId)
        this.resume(sessionId, clientId)
      }
    }
    if (!c.pressured) return
    for (const [sessionId, bytes] of c.bySession) {
      if (bytes >= sessionHigh && !c.paused.has(sessionId)) {
        c.paused.add(sessionId)
        this.pause(sessionId, clientId)
      }
    }
  }
}
