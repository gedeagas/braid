/**
 * Binary wire format for PTY output streamed from the desktop (protocol v3+).
 *
 * Mirror of `src/main/services/mobileServer/terminalFrame.ts` on the desktop.
 * The desktop encodes raw terminal bytes into this frame, encrypts it with the
 * session's NaCl box key + lockstep nonce counter, and sends it as a *binary*
 * WebSocket frame - avoiding the JSON-escape + base64 overhead of the legacy
 * `terminal.data` notification on the output hot path.
 *
 * Plaintext layout (before encryption):
 *   byte  0       : frame kind (TERMINAL_FRAME_DATA = 0x01)
 *   byte  1       : reserved flags (0x00)
 *   bytes 2..3    : ptyId byte length, uint16 big-endian
 *   bytes 4..4+N  : ptyId, UTF-8
 *   bytes 4+N..   : terminal output, UTF-8 (raw, unescaped)
 */

export const TERMINAL_FRAME_DATA = 0x01;

const HEADER_BYTES = 4;
const MAX_PTY_ID_BYTES = 0xffff;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeTerminalFrame(ptyId: string, data: string): Uint8Array {
  const ptyIdBytes = textEncoder.encode(ptyId);
  if (ptyIdBytes.length > MAX_PTY_ID_BYTES) {
    throw new Error(`ptyId too long for binary frame: ${ptyIdBytes.length} bytes`);
  }
  const dataBytes = textEncoder.encode(data);
  const out = new Uint8Array(HEADER_BYTES + ptyIdBytes.length + dataBytes.length);
  out[0] = TERMINAL_FRAME_DATA;
  out[1] = 0x00;
  out[2] = (ptyIdBytes.length >> 8) & 0xff;
  out[3] = ptyIdBytes.length & 0xff;
  out.set(ptyIdBytes, HEADER_BYTES);
  out.set(dataBytes, HEADER_BYTES + ptyIdBytes.length);
  return out;
}

export interface DecodedTerminalFrame {
  ptyId: string;
  data: string;
}

/** Decode a binary frame plaintext; returns null for malformed/unknown input. */
export function decodeTerminalFrame(bytes: Uint8Array): DecodedTerminalFrame | null {
  if (bytes.length < HEADER_BYTES) return null;
  if (bytes[0] !== TERMINAL_FRAME_DATA) return null;
  const ptyIdLen = (bytes[2] << 8) | bytes[3];
  const dataStart = HEADER_BYTES + ptyIdLen;
  if (dataStart > bytes.length) return null;
  const ptyId = textDecoder.decode(bytes.subarray(HEADER_BYTES, dataStart));
  const data = textDecoder.decode(bytes.subarray(dataStart));
  return { ptyId, data };
}
