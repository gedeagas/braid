import { WebSocketServer, WebSocket } from 'ws'
import crypto from 'crypto'
import { hostname, networkInterfaces } from 'os'
import { logger } from '../../lib/logger'
import { DEFAULT_MOBILE_PORT } from '../../../shared/mobile-protocol'
import { deviceStore } from './deviceStore'
import { dispatch } from './rpc'
import * as discovery from './discovery'
import * as e2ee from './e2ee'
import type {
  MobileConnection,
  E2EESession,
  E2EEHello,
  E2EEAuth,
  JsonRpcRequest,
  JsonRpcNotification,
  MobileServerStatus,
  PairingOffer,
} from './types'

const HANDSHAKE_TIMEOUT_MS = 5_000
const PING_INTERVAL_MS = 20_000
const PONG_TIMEOUT_MS = 10_000

class MobileServer {
  private wss: WebSocketServer | null = null
  private connections = new Map<string, MobileConnection>() // deviceId -> connection
  private instanceId: string
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private port: number | null = null

  constructor() {
    this.instanceId = this.loadOrCreateInstanceId()
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async start(): Promise<{ port: number }> {
    if (this.wss) {
      throw new Error('Mobile server is already running')
    }

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: DEFAULT_MOBILE_PORT,
        host: '0.0.0.0',
      })

      this.wss.on('listening', () => {
        const addr = this.wss!.address()
        this.port = typeof addr === 'object' && addr !== null ? addr.port : DEFAULT_MOBILE_PORT
        logger.info(`[MobileServer] Listening on port ${this.port}`)

        // Start Bonjour advertisement
        discovery.advertise(this.port, this.instanceId)

        // Start activity probe
        this.startPingInterval()

        resolve({ port: this.port })
      })

      this.wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Port taken, try ephemeral port
          logger.warn(`[MobileServer] Port ${DEFAULT_MOBILE_PORT} in use, trying ephemeral`)
          this.wss!.close()
          this.wss = new WebSocketServer({ port: 0, host: '0.0.0.0' })
          this.wss.on('listening', () => {
            const addr = this.wss!.address()
            this.port = typeof addr === 'object' && addr !== null ? addr.port : 0
            logger.info(`[MobileServer] Listening on fallback port ${this.port}`)
            discovery.advertise(this.port, this.instanceId)
            this.startPingInterval()
            resolve({ port: this.port })
          })
          this.wss.on('connection', (ws) => this.handleConnection(ws))
          this.wss.on('error', reject)
        } else {
          reject(err)
        }
      })

      this.wss.on('connection', (ws) => this.handleConnection(ws))
    })
  }

  stop(): void {
    this.stopPingInterval()
    discovery.stop()

    // Clean up all connections
    for (const [, conn] of this.connections) {
      for (const unsub of conn.subscriptions.values()) unsub()
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.close(1001, 'Server shutting down')
      }
    }
    this.connections.clear()

    if (this.wss) {
      this.wss.close()
      this.wss = null
      this.port = null
    }
    logger.info('[MobileServer] Stopped')
  }

  // ── Connection handling ───────────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    logger.info('[MobileServer] New WebSocket connection')

    // Set up handshake timeout
    const handshakeTimer = setTimeout(() => {
      logger.warn('[MobileServer] Handshake timeout, closing connection')
      ws.close(4001, 'Handshake timeout')
    }, HANDSHAKE_TIMEOUT_MS)

    let handshakePhase: 'awaiting_hello' | 'awaiting_auth' | 'authenticated' = 'awaiting_hello'
    let serverEphemeral: ReturnType<typeof e2ee.generateKeyPair> | null = null
    let session: E2EESession | null = null

    ws.on('message', async (rawData: Buffer | string) => {
      const data = typeof rawData === 'string' ? rawData : rawData.toString('utf-8')

      try {
        if (handshakePhase === 'awaiting_hello') {
          // Step 1: Receive e2ee_hello (plaintext)
          const hello = JSON.parse(data) as E2EEHello
          if (hello.type !== 'e2ee_hello') {
            ws.close(4001, 'Expected e2ee_hello')
            clearTimeout(handshakeTimer)
            return
          }

          // Validate device token
          const device = deviceStore.getByToken(hello.deviceToken)
          if (!device) {
            logger.warn('[MobileServer] Invalid device token')
            ws.close(4001, 'Invalid device token')
            clearTimeout(handshakeTimer)
            return
          }

          // Generate ephemeral keypair and derive shared key
          serverEphemeral = e2ee.generateKeyPair()
          const remotePublicKey = e2ee.fromBase64(hello.ephemeralPublicKey)
          const sharedKey = e2ee.deriveSharedKey(serverEphemeral.secretKey, remotePublicKey)

          session = {
            sharedKey,
            localKeyPair: serverEphemeral,
            remotePublicKey,
            nonceCounter: 0,
          }

          // Step 2: Send e2ee_ready (plaintext - last plaintext message)
          ws.send(JSON.stringify({
            type: 'e2ee_ready',
            serverEphemeralPublicKey: e2ee.toBase64(serverEphemeral.publicKey),
          }))

          handshakePhase = 'awaiting_auth'
          return
        }

        if (handshakePhase === 'awaiting_auth') {
          // Step 3: Receive encrypted e2ee_auth
          if (!session) {
            ws.close(4001, 'No E2EE session')
            clearTimeout(handshakeTimer)
            return
          }

          const result = e2ee.decryptJson<E2EEAuth>(data, session.sharedKey, 0, false)
          if (!result || result.data.type !== 'e2ee_auth') {
            logger.warn('[MobileServer] Failed to decrypt auth message')
            ws.close(4001, 'Auth failed')
            clearTimeout(handshakeTimer)
            return
          }
          session.nonceCounter = result.nextCounter

          const authMsg = result.data

          // For new pairings, finalize the device
          let device = authMsg.deviceId ? deviceStore.getById(authMsg.deviceId) : null
          if (!device) {
            // This is a new pairing - look up by the original token
            const tokenDevice = deviceStore.load().find((d) => d.publicKey === '' || d.publicKey === authMsg.devicePublicKey)
            if (tokenDevice) {
              device = deviceStore.finalizePairing(tokenDevice.token, authMsg.deviceName, authMsg.devicePublicKey)
            }
          }

          if (!device) {
            ws.close(4001, 'Unknown device')
            clearTimeout(handshakeTimer)
            return
          }

          deviceStore.updateLastSeen(device.id)
          clearTimeout(handshakeTimer)

          // Send authenticated response (encrypted)
          const { encrypted, nextCounter } = e2ee.encryptJson(
            { type: 'e2ee_authenticated', deviceId: device.id, instanceName: hostname() },
            session.sharedKey,
            session.nonceCounter,
            true
          )
          session.nonceCounter = nextCounter
          ws.send(encrypted)

          // Register connection
          const connection: MobileConnection = {
            ws,
            device,
            e2ee: session,
            subscriptions: new Map(),
            connectedAt: Date.now(),
          }

          // Close existing connection from same device
          const existing = this.connections.get(device.id)
          if (existing) {
            for (const unsub of existing.subscriptions.values()) unsub()
            if (existing.ws.readyState === WebSocket.OPEN) {
              existing.ws.close(4000, 'Replaced by new connection')
            }
          }

          this.connections.set(device.id, connection)
          handshakePhase = 'authenticated'

          // Set up notification forwarding for this connection
          this.setupNotificationForwarding(connection)

          logger.info(`[MobileServer] Device "${device.name}" (${device.id}) authenticated`)
          return
        }

        // ── Authenticated phase: decrypt and dispatch RPC ──────────────
        if (handshakePhase === 'authenticated' && session) {
          const conn = this.findConnectionByWs(ws)
          if (!conn) return

          const result = e2ee.decryptJson<JsonRpcRequest>(data, session.sharedKey, conn.e2ee.nonceCounter, false)
          if (!result) {
            logger.warn('[MobileServer] Failed to decrypt RPC message')
            return
          }
          conn.e2ee.nonceCounter = result.nextCounter

          const response = await dispatch(result.data, conn)
          const { encrypted, nextCounter } = e2ee.encryptJson(
            response,
            session.sharedKey,
            conn.e2ee.nonceCounter,
            true
          )
          conn.e2ee.nonceCounter = nextCounter
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(encrypted)
          }
        }
      } catch (err) {
        logger.error('[MobileServer] Message handling error:', err)
      }
    })

    ws.on('close', () => {
      clearTimeout(handshakeTimer)
      const conn = this.findConnectionByWs(ws)
      if (conn) {
        logger.info(`[MobileServer] Device "${conn.device.name}" disconnected`)
        for (const unsub of conn.subscriptions.values()) unsub()
        deviceStore.updateLastSeen(conn.device.id)
        this.connections.delete(conn.device.id)
      }
    })

    ws.on('error', (err) => {
      logger.warn('[MobileServer] WebSocket error:', err)
    })
  }

  // ── Notification forwarding (subscriptions) ───────────────────────────

  private setupNotificationForwarding(connection: MobileConnection): void {
    connection.ws.on('rpc:notification', (notification: JsonRpcNotification) => {
      try {
        const { encrypted, nextCounter } = e2ee.encryptJson(
          notification,
          connection.e2ee.sharedKey,
          connection.e2ee.nonceCounter,
          true
        )
        connection.e2ee.nonceCounter = nextCounter
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.send(encrypted)
        }
      } catch (err) {
        logger.error('[MobileServer] Failed to send notification:', err)
      }
    })
  }

  // ── Broadcast to all connected devices ────────────────────────────────

  broadcastAgentEvent(sessionId: string, event: unknown): void {
    for (const conn of this.connections.values()) {
      const notification: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'agent.event',
        params: { sessionId, event },
      }
      try {
        const { encrypted, nextCounter } = e2ee.encryptJson(
          notification,
          conn.e2ee.sharedKey,
          conn.e2ee.nonceCounter,
          true
        )
        conn.e2ee.nonceCounter = nextCounter
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(encrypted)
        }
      } catch {
        // Connection may be stale
      }
    }
  }

  broadcastPtyData(ptyId: string, data: string): void {
    for (const conn of this.connections.values()) {
      const notification: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'terminal.data',
        params: { ptyId, data },
      }
      try {
        const { encrypted, nextCounter } = e2ee.encryptJson(
          notification,
          conn.e2ee.sharedKey,
          conn.e2ee.nonceCounter,
          true
        )
        conn.e2ee.nonceCounter = nextCounter
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(encrypted)
        }
      } catch {
        // Connection may be stale
      }
    }
  }

  // ── Activity probe (ping/pong) ────────────────────────────────────────

  private startPingInterval(): void {
    this.pingTimer = setInterval(() => {
      for (const [deviceId, conn] of this.connections) {
        if (conn.ws.readyState !== WebSocket.OPEN) {
          this.cleanupConnection(deviceId)
          continue
        }

        // Use WebSocket protocol-level ping
        let pongReceived = false
        const pongHandler = () => { pongReceived = true }
        conn.ws.once('pong', pongHandler)
        conn.ws.ping()

        setTimeout(() => {
          conn.ws.removeListener('pong', pongHandler)
          if (!pongReceived && conn.ws.readyState === WebSocket.OPEN) {
            logger.warn(`[MobileServer] Device "${conn.device.name}" did not respond to ping`)
            conn.ws.close(4002, 'Ping timeout')
            this.cleanupConnection(deviceId)
          }
        }, PONG_TIMEOUT_MS)
      }
    }, PING_INTERVAL_MS)
  }

  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private cleanupConnection(deviceId: string): void {
    const conn = this.connections.get(deviceId)
    if (conn) {
      for (const unsub of conn.subscriptions.values()) unsub()
      this.connections.delete(deviceId)
    }
  }

  // ── Pairing ───────────────────────────────────────────────────────────

  /** Generate a pairing offer for display as QR code. */
  generatePairingOffer(): PairingOffer | null {
    if (!this.port) return null
    const lanIp = this.getLanIp()
    if (!lanIp) return null

    const token = deviceStore.createPairingToken()
    return {
      endpoint: `ws://${lanIp}:${this.port}`,
      token,
      serverPublicKey: this.instanceId,
    }
  }

  // ── Status ────────────────────────────────────────────────────────────

  getStatus(): MobileServerStatus {
    return {
      running: this.wss !== null,
      port: this.port,
      connectedDevices: Array.from(this.connections.values()).map((c) => ({
        id: c.device.id,
        name: c.device.name,
        connectedAt: c.connectedAt,
      })),
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private findConnectionByWs(ws: WebSocket): MobileConnection | null {
    for (const conn of this.connections.values()) {
      if (conn.ws === ws) return conn
    }
    return null
  }

  private getLanIp(): string | null {
    const interfaces = networkInterfaces()
    for (const ifaces of Object.values(interfaces)) {
      if (!ifaces) continue
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address
        }
      }
    }
    return null
  }

  private loadOrCreateInstanceId(): string {
    try {
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs')
      const { join } = require('path')
      const { homedir } = require('os')
      const configDir = join(homedir(), 'Braid')
      const idPath = join(configDir, 'instance-id')

      if (existsSync(idPath)) {
        return readFileSync(idPath, 'utf-8').trim()
      }

      const id = crypto.randomUUID()
      mkdirSync(configDir, { recursive: true })
      writeFileSync(idPath, id, 'utf-8')
      return id
    } catch {
      return crypto.randomUUID()
    }
  }
}

export const mobileServer = new MobileServer()
