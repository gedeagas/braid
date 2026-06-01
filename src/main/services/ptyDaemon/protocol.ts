/**
 * NDJSON protocol definitions for PTY daemon communication.
 *
 * Socket path: ~/Braid/daemon/pty-v1.sock
 * Messages are newline-delimited JSON (one JSON object per line).
 */
import { join } from 'path'
import { homedir } from 'os'
import { DEFAULT_TERMINAL_SCROLLBACK_LINES, getTerminalScrollbackBufferMaxLength } from '../../../shared/terminal'
import type { DaemonSessionMetadata } from './types'

// ── Constants ────────────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = 1
export const DAEMON_DIR = join(homedir(), 'Braid', 'daemon')
export const SOCKET_PATH = join(DAEMON_DIR, `pty-v${PROTOCOL_VERSION}.sock`)
export const PID_FILE_PATH = join(DAEMON_DIR, `pty-daemon.pid`)
export const CHECKPOINT_DIR = join(DAEMON_DIR, 'checkpoints')

/** Auto-shutdown after 10 minutes with no connected clients. */
export const IDLE_SHUTDOWN_MS = 10 * 60 * 1000

/** Checkpoint interval in milliseconds. */
export const CHECKPOINT_INTERVAL_MS = 5_000

/** Maximum RingBuffer size per session. */
export const BUFFER_MAX_LENGTH = getTerminalScrollbackBufferMaxLength(DEFAULT_TERMINAL_SCROLLBACK_LINES)

// ── Client -> Daemon Requests ────────────────────────────────────────────────

export interface SpawnRequest {
  id: string
  type: 'spawn'
  sessionId: string
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
  shell?: string
  bufferMaxLength?: number
}

export interface AttachRequest {
  id: string
  type: 'attach'
  sessionId: string
}

export interface WriteRequest {
  id: string
  type: 'write'
  sessionId: string
  data: string
}

export interface ResizeRequest {
  id: string
  type: 'resize'
  sessionId: string
  cols: number
  rows: number
}

export interface KillRequest {
  id: string
  type: 'kill'
  sessionId: string
}

export interface SnapshotRequest {
  id: string
  type: 'snapshot'
  sessionId: string
}

export interface ListRequest {
  id: string
  type: 'list'
}

export interface SetBufferMaxLengthRequest {
  id: string
  type: 'setBufferMaxLength'
  maxLength: number
}

export interface SetMetadataRequest {
  id: string
  type: 'setMetadata'
  sessionId: string
  metadata: DaemonSessionMetadata
}

export interface PingRequest {
  id: string
  type: 'ping'
}

export interface ShutdownRequest {
  id: string
  type: 'shutdown'
}

export type DaemonRequest =
  | SpawnRequest
  | AttachRequest
  | WriteRequest
  | ResizeRequest
  | KillRequest
  | SnapshotRequest
  | ListRequest
  | SetBufferMaxLengthRequest
  | SetMetadataRequest
  | PingRequest
  | ShutdownRequest

// ── Daemon -> Client Events (no id, pushed) ─────────────────────────────────

export interface DataEvent {
  type: 'data'
  sessionId: string
  data: string
}

export interface ExitEvent {
  type: 'exit'
  sessionId: string
  exitCode: number
}

export type DaemonEvent = DataEvent | ExitEvent

// ── Daemon -> Client Responses (correlated by id) ───────────────────────────

export interface OkResponse {
  id: string
  type: 'ok'
  data?: unknown
}

export interface ErrorResponse {
  id: string
  type: 'error'
  message: string
}

export type DaemonResponse = OkResponse | ErrorResponse

/** Any message that can flow over the socket. */
export type DaemonMessage = DaemonRequest | DaemonEvent | DaemonResponse

// ── Framing helpers ──────────────────────────────────────────────────────────

/** Encode a message to an NDJSON line (with trailing newline). */
export function encode(msg: DaemonMessage): string {
  return JSON.stringify(msg) + '\n'
}

/** Parse a single NDJSON line. Returns null on invalid JSON. */
export function decode(line: string): DaemonMessage | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as DaemonMessage
  } catch {
    return null
  }
}
