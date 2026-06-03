import type { WebSocket } from 'ws'

// ── Device Trust ──────────────────────────────────────────────────────────────

export interface TrustedDevice {
  id: string                    // UUID, generated on first pair
  name: string                  // User-facing label (e.g. "Gede's iPhone")
  publicKey: string             // Base64-encoded Curve25519 public key (permanent)
  token: string                 // Random 32-byte hex token for auth handshake
  pairedAt: number              // Date.now()
  lastSeenAt: number            // Updated on each successful connection
  pairingTransport?: MobilePairingTransport // Transport used by the pairing offer that created this device
}

// ── E2EE Session ──────────────────────────────────────────────────────────────

export interface E2EESession {
  sharedKey: Uint8Array          // Derived from ECDH (NaCl box beforenm)
  localKeyPair: {
    publicKey: Uint8Array
    secretKey: Uint8Array
  }
  remotePublicKey: Uint8Array    // Mobile's ephemeral public key
  deviceId: string               // Bound during hello phase to prevent session hijacking
  deviceToken: string            // Bound during hello phase for secure pairing finalization
}

// ── Connection ────────────────────────────────────────────────────────────────

export interface MobileConnection {
  ws: WebSocket
  device: TrustedDevice
  e2ee: E2EESession
  subscriptions: Map<string, () => void>  // subscriptionId -> unsubscribe fn
  connectedAt: number
  sendQueue: Promise<void>
  // Negotiated in e2ee_auth (protocol v3+). When true, PTY output streams as
  // raw bytes in encrypted binary WS frames instead of base64'd JSON.
  binaryTerminalData: boolean
  // When true, terminal.subscribe returns the scrollback snapshot in its result
  // (and the device skips the separate readScrollback), so the snapshot can't
  // race behind live output. See the terminal.subscribe-snapshot.v1 capability.
  subscribeSnapshot: boolean
  transport?: MobilePairingTransport
}

// ── Pairing ───────────────────────────────────────────────────────────────────

export interface PairingOffer {
  endpoint: string                // "ws://<lanIp>:6839"
  token: string                   // One-time pairing token
  serverPublicKey: string         // Base64-encoded identity public key
  transport?: MobilePairingTransport
}

export type MobilePairingTransport = 'lan' | 'ngrok'

export type MobileNgrokRegion = 'auto' | 'us' | 'eu' | 'au' | 'ap' | 'sa' | 'jp' | 'in' | 'us-cal-1' | 'eu-lon-1'

export interface GeneratePairingOfferOptions {
  endpoint?: string
  transport?: MobilePairingTransport
}

// ── E2EE Handshake Messages (plaintext phase) ────────────────────────────────

export interface E2EEHello {
  type: 'e2ee_hello'
  ephemeralPublicKey: string      // Base64-encoded
  deviceToken?: string            // Legacy plaintext token; new clients send it in encrypted auth
}

export interface E2EEReady {
  type: 'e2ee_ready'
  serverEphemeralPublicKey: string // Base64-encoded
}

export interface E2EEAuth {
  type: 'e2ee_auth'
  deviceId?: string               // Present for returning devices
  deviceToken?: string            // One-time pairing token or existing device token
  deviceName: string              // User-facing name for this mobile device
  devicePublicKey: string         // Base64-encoded permanent Curve25519 key
  capabilities?: MobileClientCapabilities  // Optional feature negotiation (v3+)
}

/** Optional features a mobile client advertises during the auth handshake. */
export interface MobileClientCapabilities {
  // Client can decode the binary terminal-output channel (protocol v3+).
  binaryTerminalData?: boolean
  // Client wants the scrollback snapshot delivered in the terminal.subscribe
  // result rather than fetching it via a separate readScrollback round-trip.
  subscribeSnapshot?: boolean
}

export interface E2EEAuthenticated {
  type: 'e2ee_authenticated'
  deviceId: string
  instanceName: string
  deviceToken?: string
}

export type HandshakeMessage = E2EEHello | E2EEReady | E2EEAuth | E2EEAuthenticated

// ── JSON-RPC 2.0 ─────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params: Record<string, unknown>
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

// Standard JSON-RPC error codes
export const RPC_PARSE_ERROR = -32700
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603

// ── RPC Handler Types ─────────────────────────────────────────────────────────

export type RpcHandler = (
  params: Record<string, unknown>,
  connection: MobileConnection
) => Promise<unknown>

export type RpcMethodMap = Map<string, RpcHandler>

// ── Server Status ─────────────────────────────────────────────────────────────

export interface MobileServerStatus {
  running: boolean
  port: number | null
  connectedDevices: Array<{
    id: string
    name: string
    connectedAt: number
  }>
}

export interface MobileNgrokTunnelStatus {
  running: boolean
  port: number | null
  url: string | null
  endpoint: string | null
  startedAt: number | null
  error: string | null
}
