/**
 * Binary wire format for streaming PTY output to paired mobile devices.
 *
 * Why: the JSON-RPC `terminal.data` notification path pays a heavy per-frame
 * tax on the hot path - `JSON.stringify` escapes every control byte in the
 * terminal stream, and the encrypted result is base64-encoded (1.33x size
 * inflation) before going out as a WebSocket *text* frame. For a terminal
 * firehose (build logs, `cat`, TUI repaints) that is the dominant cost and the
 * main source of mobile lag.
 *
 * This format carries the raw output bytes verbatim inside the encrypted
 * payload of a binary WebSocket frame: no JSON escaping, no base64. The frame is
 * sealed with the session's NaCl box key and its own random nonce (see
 * e2ee.sealBytes), independently of the JSON channel - the receiver simply
 * branches on the WebSocket frame type (binary vs text).
 *
 * Plaintext layout (before encryption):
 *   byte  0       : frame kind (TERMINAL_FRAME_DATA = 0x01)
 *   byte  1       : reserved flags (0x00)
 *   bytes 2..3    : ptyId byte length, uint16 big-endian
 *   bytes 4..4+N  : ptyId, UTF-8
 *   bytes 4+N..   : terminal output, UTF-8 (raw, unescaped)
 *
 * Keep this in sync with `mobile-app/src/transport/terminal-frame.ts`.
 */

export const TERMINAL_FRAME_DATA = 0x01

const HEADER_BYTES = 4
const MAX_PTY_ID_BYTES = 0xffff

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Encode a terminal output chunk into the binary frame plaintext. */
export function encodeTerminalFrame(ptyId: string, data: string): Uint8Array {
  const ptyIdBytes = textEncoder.encode(ptyId)
  if (ptyIdBytes.length > MAX_PTY_ID_BYTES) {
    throw new Error(`ptyId too long for binary frame: ${ptyIdBytes.length} bytes`)
  }
  const dataBytes = textEncoder.encode(data)
  const out = new Uint8Array(HEADER_BYTES + ptyIdBytes.length + dataBytes.length)
  out[0] = TERMINAL_FRAME_DATA
  out[1] = 0x00
  out[2] = (ptyIdBytes.length >> 8) & 0xff
  out[3] = ptyIdBytes.length & 0xff
  out.set(ptyIdBytes, HEADER_BYTES)
  out.set(dataBytes, HEADER_BYTES + ptyIdBytes.length)
  return out
}

export interface DecodedTerminalFrame {
  ptyId: string
  data: string
}

/**
 * Decode a binary frame plaintext back to { ptyId, data }. Returns null when
 * the payload is not a recognized terminal frame (wrong kind / truncated) so
 * callers can ignore malformed input instead of throwing on the hot path.
 */
export function decodeTerminalFrame(bytes: Uint8Array): DecodedTerminalFrame | null {
  if (bytes.length < HEADER_BYTES) return null
  if (bytes[0] !== TERMINAL_FRAME_DATA) return null
  const ptyIdLen = (bytes[2] << 8) | bytes[3]
  const dataStart = HEADER_BYTES + ptyIdLen
  if (dataStart > bytes.length) return null
  const ptyId = textDecoder.decode(bytes.subarray(HEADER_BYTES, dataStart))
  const data = textDecoder.decode(bytes.subarray(dataStart))
  return { ptyId, data }
}
