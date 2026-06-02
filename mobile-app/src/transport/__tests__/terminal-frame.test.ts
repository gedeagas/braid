import {
  TERMINAL_FRAME_DATA,
  decodeTerminalFrame,
  encodeTerminalFrame,
} from '../terminal-frame';

// The binary terminal-output frame is the v3 hot path: the desktop encodes raw
// PTY bytes into this layout, encrypts, and ships it as a binary WS frame; the
// mobile client decodes it here. These tests pin the wire format and its
// edge-case handling so it stays byte-compatible with the desktop encoder in
// src/main/services/mobileServer/terminalFrame.ts.

describe('terminal-frame', () => {
  it('round-trips ptyId and data', () => {
    const frame = encodeTerminalFrame('pty-123', 'hello world');
    expect(frame[0]).toBe(TERMINAL_FRAME_DATA);
    expect(decodeTerminalFrame(frame)).toEqual({ ptyId: 'pty-123', data: 'hello world' });
  });

  it('preserves control bytes and escape sequences verbatim', () => {
    const data = '\x1b[2J\x1b[H\x1b[?1049h\r\nbuild output\x00\x07';
    expect(decodeTerminalFrame(encodeTerminalFrame('p', data))?.data).toBe(data);
  });

  it('preserves multibyte UTF-8 (emoji, CJK)', () => {
    const data = '日本語 🚀 café';
    expect(decodeTerminalFrame(encodeTerminalFrame('pty', data))?.data).toBe(data);
  });

  it('handles empty data', () => {
    expect(decodeTerminalFrame(encodeTerminalFrame('pty-x', ''))).toEqual({ ptyId: 'pty-x', data: '' });
  });

  it('lays out the header as [kind, flags, ptyIdLen u16 BE]', () => {
    const frame = encodeTerminalFrame('abc', 'x');
    expect(frame[0]).toBe(TERMINAL_FRAME_DATA);
    expect(frame[1]).toBe(0x00);
    expect((frame[2] << 8) | frame[3]).toBe(3); // 'abc' = 3 UTF-8 bytes
  });

  it('returns null for a non-terminal kind byte', () => {
    const frame = encodeTerminalFrame('pty', 'data');
    frame[0] = 0x99;
    expect(decodeTerminalFrame(frame)).toBeNull();
  });

  it('returns null for a truncated header', () => {
    expect(decodeTerminalFrame(new Uint8Array([0x01, 0x00]))).toBeNull();
  });

  it('returns null when the ptyId length runs past the buffer', () => {
    const frame = encodeTerminalFrame('pty', 'data');
    frame[2] = 0xff;
    frame[3] = 0xff;
    expect(decodeTerminalFrame(frame)).toBeNull();
  });

  it('throws when ptyId exceeds the uint16 length field', () => {
    expect(() => encodeTerminalFrame('p'.repeat(0x10000), 'x')).toThrow(/ptyId too long/);
  });

  it('decodes a frame produced by the desktop wire layout', () => {
    // Hand-built frame matching terminalFrame.ts on the desktop: ptyId="pty"
    // (3 bytes) followed by data "ok". Proves cross-side compatibility without
    // importing main-process code.
    const raw = new Uint8Array([
      TERMINAL_FRAME_DATA,
      0x00,
      0x00,
      0x03,
      ...new TextEncoder().encode('pty'),
      ...new TextEncoder().encode('ok'),
    ]);
    expect(decodeTerminalFrame(raw)).toEqual({ ptyId: 'pty', data: 'ok' });
  });
});
