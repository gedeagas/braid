/**
 * NDJSON protocol definitions for PTY daemon communication.
 *
 * Transport: a local IPC endpoint addressed by `SOCKET_PATH`.
 *  - POSIX:   a Unix domain socket at ~/Braid/daemon/pty-v1.sock
 *  - Windows: a named pipe \\.\pipe\braid-pty-v1-<userKey>
 * Node's `net` server/client speak both behind the same string-path API, so the
 * only platform difference is how this address is computed.
 *
 * Messages are newline-delimited JSON (one JSON object per line).
 */
import { join } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import { DEFAULT_TERMINAL_SCROLLBACK_LINES, getTerminalScrollbackBufferMaxLength } from '../../../shared/terminal'
import type { DaemonSessionMetadata } from './types'

// ── Constants ────────────────────────────────────────────────────────────────

// Never bump this for new capabilities: it is part of the socket path, so a
// new app would miss the daemon an older build left running (with the user's
// shells and agents in it). Add a feature to DAEMON_FEATURES instead.
export const PROTOCOL_VERSION = 1

/**
 * Capabilities this daemon build supports, reported in the `hello` reply. A
 * daemon from before this list existed sends no `features`, which clients
 * read as "none". A client must never send a request type whose feature the
 * daemon did not list: an older daemon answers `Unknown request type`.
 *  - flow-control: `pause` / `resume` requests (producer backpressure)
 *  - headless-snapshot: a headless terminal per session; `headlessSnapshot`
 *    and `setVisible` requests, and `seq` on data events
 *  - status-events: `status` events from agent detection in the daemon
 */
export const DAEMON_FEATURES = ['flow-control', 'headless-snapshot', 'status-events'] as const
export type DaemonFeature = (typeof DAEMON_FEATURES)[number]
/** Env var carrying the spawning app's version into the daemon process. */
export const DAEMON_VERSION_ENV = 'BRAID_DAEMON_VERSION'
export const DAEMON_DIR = join(homedir(), 'Braid', 'daemon')

/**
 * Compute the daemon IPC endpoint address.
 *
 * On Windows a named pipe is NOT a filesystem entry, so it cannot live under
 * DAEMON_DIR. We namespace the pipe by a short hash of the home directory so
 * concurrent users on the same machine don't collide on one global pipe name.
 */
export function getDaemonSocketPath(): string {
  if (process.platform === 'win32') {
    const userKey = createHash('sha1').update(homedir()).digest('hex').slice(0, 8)
    return `\\\\.\\pipe\\braid-pty-v${PROTOCOL_VERSION}-${userKey}`
  }
  return join(DAEMON_DIR, `pty-v${PROTOCOL_VERSION}.sock`)
}

export const SOCKET_PATH = getDaemonSocketPath()
/** True when SOCKET_PATH is a real file on disk (POSIX), false for Windows pipes. */
export const SOCKET_IS_FILE = process.platform !== 'win32'
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
  /** Headless terminal scrollback in lines (terminal scrollback setting). */
  scrollback?: number
  /** This client delivers the session's output to a renderer right away. */
  visible?: boolean
}

export interface AttachRequest {
  id: string
  type: 'attach'
  sessionId: string
  /** This client delivers the output to a renderer (it answers queries then). */
  visible?: boolean
  /** With `visible`: a headlessSnapshot request follows (see SetVisibleRequest). */
  snapshotFollows?: boolean
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
  /** Headless terminal scrollback in lines. */
  scrollback?: number
}

export interface SetMetadataRequest {
  id: string
  type: 'setMetadata'
  sessionId: string
  metadata: DaemonSessionMetadata
}

/** Atomically claim a cold-restored session (one-shot; see SessionHost). */
export interface ConsumeColdRestoreRequest {
  id: string
  type: 'consumeColdRestore'
  sessionId: string
}

/** Ask the daemon which app build spawned it (for version-skew handling). */
export interface HelloRequest {
  id: string
  type: 'hello'
}

/** Stop reading a session's PTY (feature: flow-control). Fire-and-forget. */
export interface PauseRequest {
  id: string
  type: 'pause'
  sessionId: string
}

/** Undo a pause (feature: flow-control). Fire-and-forget. */
export interface ResumeRequest {
  id: string
  type: 'resume'
  sessionId: string
}

/** Screen snapshot from the session's headless terminal (feature: headless-snapshot). */
export interface HeadlessSnapshotRequest {
  id: string
  type: 'headlessSnapshot'
  sessionId: string
}

/**
 * Whether this client delivers the session's output to a renderer (feature:
 * headless-snapshot). The headless terminal answers the program's terminal
 * queries in the output no renderer answers. The ok reply carries `{ seq }`:
 * on show, the daemon answers live output numbered up to it, so the client
 * must deliver that output without letting the renderer reply.
 */
export interface SetVisibleRequest {
  id: string
  type: 'setVisible'
  sessionId: string
  visible: boolean
  /** Shown: a headlessSnapshot request follows; keep answering until it is taken. */
  snapshotFollows?: boolean
  /** Hidden: the last seq this client delivered to the renderer (it answered those). */
  deliveredThrough?: number
}

/** Colours the renderer's terminals use, for OSC 10/11/12 replies (feature: headless-snapshot). */
export interface TerminalColors {
  foreground?: string
  background?: string
  cursor?: string
}

export interface SetColorsRequest {
  id: string
  type: 'setColors'
  colors: TerminalColors
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
  | ConsumeColdRestoreRequest
  | HelloRequest
  | PauseRequest
  | ResumeRequest
  | HeadlessSnapshotRequest
  | SetVisibleRequest
  | SetColorsRequest
  | PingRequest
  | ShutdownRequest

// ── Daemon -> Client Events (no id, pushed) ─────────────────────────────────

export interface DataEvent {
  type: 'data'
  sessionId: string
  data: string
  /** Running output sequence number per session (feature: headless-snapshot). */
  seq?: number
}

/** Agent status the daemon detected (feature: status-events). */
export interface WireAgentStatus {
  state: 'working' | 'blocked' | 'waiting' | 'done'
  agentType?: string
  toolName?: string
  toolInput?: string
  lastAssistantMessage?: string
  prompt?: string
  interrupted?: boolean
}

export interface AgentStatusEvent {
  type: 'status'
  sessionId: string
  /** Which detector: OSC 9999, OSC 9 braid, title, Codex prompt scan. */
  kind: 'osc' | 'osc9' | 'title' | 'scan'
  status: WireAgentStatus
  /** From seeded/replayed history: set the status, but don't announce it. */
  replayed: boolean
}

/** An OSC 8 hyperlink in a snapshot: absolute row of the active buffer, columns [start, end). */
export interface SnapshotLinkRange {
  row: number
  startCol: number
  endCol: number
  uri: string
}

export interface HeadlessSnapshot {
  /** Serialized screen + modes + cursor + title + unfinished escape, to write after term.reset(). */
  data: string
  cols: number
  rows: number
  /** Output with a higher seq is not in the snapshot. */
  seq: number
  title: string
  /** OSC 8 hyperlinks (serialize() drops them); the renderer restores them. */
  links?: SnapshotLinkRange[]
}

export interface ExitEvent {
  type: 'exit'
  sessionId: string
  exitCode: number
  /** The shell ended on its own (user typed `exit`). Absent from older daemons. */
  selfExit?: boolean
}

export type DaemonEvent = DataEvent | ExitEvent | AgentStatusEvent

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
