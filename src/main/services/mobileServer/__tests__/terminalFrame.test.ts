import { describe, it, expect } from 'vitest'
import {
  encodeTerminalFrame,
  decodeTerminalFrame,
  TERMINAL_FRAME_DATA,
} from '../terminalFrame'
import {
  generateKeyPair,
  deriveSharedKey,
  sealBytes,
  openBytes,
} from '../e2ee'

describe('terminalFrame', () => {
  it('round-trips ptyId and data', () => {
    const frame = encodeTerminalFrame('pty-123', 'hello world')
    expect(frame[0]).toBe(TERMINAL_FRAME_DATA)
    const decoded = decodeTerminalFrame(frame)
    expect(decoded).toEqual({ ptyId: 'pty-123', data: 'hello world' })
  })

  it('preserves control bytes and escape sequences verbatim', () => {
    const data = '\x1b[2J\x1b[H\x1b[?1049h\r\nbuild output\x00\x07'
    const decoded = decodeTerminalFrame(encodeTerminalFrame('p', data))
    expect(decoded?.data).toBe(data)
  })

  it('preserves multibyte UTF-8 (emoji, CJK)', () => {
    const data = '日本語 🚀 café'
    const decoded = decodeTerminalFrame(encodeTerminalFrame('pty', data))
    expect(decoded?.data).toBe(data)
  })

  it('handles empty data', () => {
    const decoded = decodeTerminalFrame(encodeTerminalFrame('pty-x', ''))
    expect(decoded).toEqual({ ptyId: 'pty-x', data: '' })
  })

  it('returns null for a non-terminal kind byte', () => {
    const frame = encodeTerminalFrame('pty', 'data')
    frame[0] = 0x99
    expect(decodeTerminalFrame(frame)).toBeNull()
  })

  it('returns null for a truncated header', () => {
    expect(decodeTerminalFrame(new Uint8Array([0x01, 0x00]))).toBeNull()
  })

  it('returns null when the ptyId length runs past the buffer', () => {
    const frame = encodeTerminalFrame('pty', 'data')
    // Claim a ptyId far longer than the buffer holds.
    frame[2] = 0xff
    frame[3] = 0xff
    expect(decodeTerminalFrame(frame)).toBeNull()
  })

  it('survives a full sealed-frame encrypt/decrypt round-trip', () => {
    const server = generateKeyPair()
    const client = generateKeyPair()
    const serverShared = deriveSharedKey(server.secretKey, client.publicKey)
    const clientShared = deriveSharedKey(client.secretKey, server.publicKey)

    const data = '\x1b[32m$ yarn build\x1b[0m\r\n'
    const sealed = sealBytes(encodeTerminalFrame('pty-abc', data), serverShared)

    const recovered = openBytes(sealed, clientShared)
    expect(recovered).not.toBeNull()
    const decoded = decodeTerminalFrame(recovered!)
    expect(decoded).toEqual({ ptyId: 'pty-abc', data })
  })
})
