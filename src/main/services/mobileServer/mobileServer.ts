import { WebSocketServer, WebSocket } from 'ws'
import crypto from 'crypto'
import { networkInterfaces } from 'os'
import { logger } from '../../lib/logger'
import { DEFAULT_MOBILE_PORT } from '../../../shared/mobile-protocol'
import { deviceStore } from './deviceStore'
import { dispatch } from './rpc'
import { setMobileBroadcaster } from './broadcast'
import * as discovery from './discovery'
import * as e2ee from './e2ee'
import { encodeTerminalFrame } from './terminalFrame'
import { getMobileInstanceName } from './instanceName'
import type {
  MobileConnection,
  E2EESession,
  E2EEHello,
  E2EEAuth,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  MobileServerStatus,
  PairingOffer,
  GeneratePairingOfferOptions,
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
    // Register the broadcast hook so RPC/IPC handlers can push notifications
    // (e.g. terminal tab rename/close) to every connected device.
    setMobileBroadcaster((notification, exceptDeviceId) => this.broadcast(notification, exceptDeviceId))
  }

  /**
   * Push a notification to every authenticated device, optionally skipping the
   * one that originated the change. Reuses the per-connection 'rpc:notification'
   * forwarding (encryption + send-queue ordering) set up at auth time.
   */
  private broadcast(notification: JsonRpcNotification, exceptDeviceId?: string): void {
    for (const [deviceId, conn] of this.connections) {
      if (deviceId === exceptDeviceId) continue
      conn.ws.emit('rpc:notification', notification)
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async start(): Promise<{ port: number }> {
    if (this.wss) {
      if (this.port) return { port: this.port }
      this.stop()
    }

    return new Promise((resolve, reject) => {
      const rejectStart = (err: unknown) => {
        this.stopPingInterval()
        this.wss = null
        this.port = null
        reject(err)
      }

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
          this.wss.on('error', rejectStart)
        } else {
          rejectStart(err)
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

          // Generate ephemeral keypair and derive shared key
          serverEphemeral = e2ee.generateKeyPair()
          const remotePublicKey = e2ee.fromBase64(hello.ephemeralPublicKey)
          const sharedKey = e2ee.deriveSharedKey(serverEphemeral.secretKey, remotePublicKey)
          const legacyDeviceToken = typeof hello.deviceToken === 'string' ? hello.deviceToken : ''
          const legacyDevice = legacyDeviceToken ? deviceStore.getByToken(legacyDeviceToken) : null
          if (legacyDeviceToken && !legacyDevice) {
            logger.warn('[MobileServer] Invalid legacy device token')
            ws.close(4001, 'Invalid device token')
            clearTimeout(handshakeTimer)
            return
          }

          session = {
            sharedKey,
            localKeyPair: serverEphemeral,
            remotePublicKey,
            sendCounter: 0,
            receiveCounter: 0,
            deviceId: legacyDevice?.id ?? '',
            deviceToken: legacyDeviceToken,
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
          session.receiveCounter = result.nextCounter

          const authMsg = result.data
          const encryptedDeviceToken = typeof authMsg.deviceToken === 'string' ? authMsg.deviceToken : ''
          if (session.deviceToken && encryptedDeviceToken && session.deviceToken !== encryptedDeviceToken) {
            logger.warn('[MobileServer] Device token mismatch during auth')
            ws.close(4001, 'Device token mismatch')
            clearTimeout(handshakeTimer)
            return
          }
          const deviceToken = encryptedDeviceToken || session.deviceToken
          if (!deviceToken) {
            logger.warn('[MobileServer] Missing device token during auth')
            ws.close(4001, 'Missing device token')
            clearTimeout(handshakeTimer)
            return
          }

          // Retrieve the device bound during the hello phase to prevent session hijacking
          let device = session.deviceId ? deviceStore.getById(session.deviceId) : deviceStore.getByToken(deviceToken)
          if (device && device.publicKey === '') {
            // New pairing - finalize using the cryptographically bound token
            device = deviceStore.finalizePairing(deviceToken, authMsg.deviceName, authMsg.devicePublicKey)
          }

          if (!device) {
            ws.close(4001, 'Unknown device')
            clearTimeout(handshakeTimer)
            return
          }

          session.deviceId = device.id
          session.deviceToken = deviceToken

          deviceStore.updateLastSeen(device.id)
          clearTimeout(handshakeTimer)

          // Send authenticated response (encrypted)
          const { encrypted, nextCounter } = e2ee.encryptJson(
            { type: 'e2ee_authenticated', deviceId: device.id, instanceName: getMobileInstanceName(), deviceToken: device.token },
            session.sharedKey,
            session.sendCounter,
            true
          )
          session.sendCounter = nextCounter
          ws.send(encrypted)

          // Register connection
          const connection: MobileConnection = {
            ws,
            device,
            e2ee: session,
            subscriptions: new Map(),
            connectedAt: Date.now(),
            sendQueue: Promise.resolve(),
            binaryTerminalData: authMsg.capabilities?.binaryTerminalData === true,
            subscribeSnapshot: authMsg.capabilities?.subscribeSnapshot === true,
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

          const result = e2ee.decryptJson<JsonRpcRequest>(data, session.sharedKey, conn.e2ee.receiveCounter, false)
          if (!result) {
            logger.warn('[MobileServer] Failed to decrypt RPC message')
            return
          }
          conn.e2ee.receiveCounter = result.nextCounter

          const response = await dispatch(result.data, conn)
          conn.sendQueue = conn.sendQueue
            .then(() => this.sendEncrypted(conn, response as JsonRpcResponse))
            .catch((err) => {
              logger.error('[MobileServer] Failed to send RPC response:', err)
            })
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
      connection.sendQueue = connection.sendQueue
        .then(() => this.sendEncrypted(connection, notification))
        .catch((err) => {
          logger.error('[MobileServer] Failed to send notification:', err)
        })
    })
    // Raw PTY output, streamed as an encrypted binary WS frame for clients that
    // negotiated `binaryTerminalData`. Queued on the same sendQueue as JSON so
    // the lockstep nonce counter stays monotonic across both channels.
    connection.ws.on('rpc:binary', (payload: { ptyId: string; data: string }) => {
      connection.sendQueue = connection.sendQueue
        .then(() => this.sendEncryptedBinaryTerminal(connection, payload.ptyId, payload.data))
        .catch((err) => {
          logger.error('[MobileServer] Failed to send terminal frame:', err)
        })
    })
  }

  private async sendEncrypted(
    connection: MobileConnection,
    message: JsonRpcResponse | JsonRpcNotification,
  ): Promise<void> {
    const { encrypted, nextCounter } = e2ee.encryptJson(
      message,
      connection.e2ee.sharedKey,
      connection.e2ee.sendCounter,
      true
    )
    connection.e2ee.sendCounter = nextCounter
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(encrypted)
    }
  }

  /**
   * Encrypt raw PTY output as a binary frame and send it as a binary WS frame.
   * Shares the session's send-counter sequence with {@link sendEncrypted} (both
   * run on the per-connection sendQueue), so the client can decrypt binary and
   * text frames against one in-order receive counter.
   */
  private async sendEncryptedBinaryTerminal(
    connection: MobileConnection,
    ptyId: string,
    data: string,
  ): Promise<void> {
    const plaintext = encodeTerminalFrame(ptyId, data)
    const nonce = e2ee.generateNonce(connection.e2ee.sendCounter, true)
    const ciphertext = e2ee.encrypt(plaintext, connection.e2ee.sharedKey, nonce)
    connection.e2ee.sendCounter += 1
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(ciphertext, { binary: true })
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
  generatePairingOffer(options: GeneratePairingOfferOptions = {}): PairingOffer | null {
    if (!this.port) return null
    const endpoint = options.endpoint ?? (() => {
      const lanIp = this.getLanIp()
      return lanIp ? `ws://${lanIp}:${this.port}` : null
    })()
    if (!endpoint) return null

    const token = deviceStore.createPairingToken()
    return {
      endpoint,
      token,
      serverPublicKey: this.instanceId,
      transport: options.transport ?? 'lan',
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
