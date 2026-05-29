import { describe, it, expect } from 'vitest'
import { encode, decode, PROTOCOL_VERSION, SOCKET_PATH, PID_FILE_PATH, CHECKPOINT_DIR, IDLE_SHUTDOWN_MS, CHECKPOINT_INTERVAL_MS, BUFFER_MAX_LENGTH } from '../protocol'
import { DEFAULT_TERMINAL_SCROLLBACK_LINES, getTerminalScrollbackBufferMaxLength } from '../../../../shared/terminal'

describe('protocol constants', () => {
  it('has expected version', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it('socket path includes version', () => {
    expect(SOCKET_PATH).toContain('pty-v1.sock')
  })

  it('paths are under ~/Braid/daemon/', () => {
    expect(SOCKET_PATH).toContain('Braid/daemon/')
    expect(PID_FILE_PATH).toContain('Braid/daemon/')
    expect(CHECKPOINT_DIR).toContain('Braid/daemon/')
  })

  it('has reasonable timeout and buffer values', () => {
    expect(IDLE_SHUTDOWN_MS).toBe(600_000) // 10 minutes
    expect(CHECKPOINT_INTERVAL_MS).toBe(5_000)
    expect(BUFFER_MAX_LENGTH).toBe(getTerminalScrollbackBufferMaxLength(DEFAULT_TERMINAL_SCROLLBACK_LINES))
  })
})

describe('encode', () => {
  it('serializes a message to NDJSON (trailing newline)', () => {
    const msg = { id: '1', type: 'ping' as const }
    const result = encode(msg)
    expect(result).toBe('{"id":"1","type":"ping"}\n')
  })

  it('handles complex messages with nested data', () => {
    const msg = { id: '2', type: 'ok' as const, data: { snapshot: 'hello\nworld' } }
    const result = encode(msg)
    expect(result.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(result.trim())
    expect(parsed.data.snapshot).toBe('hello\nworld')
  })
})

describe('decode', () => {
  it('parses a valid NDJSON line', () => {
    const result = decode('{"id":"1","type":"ping"}')
    expect(result).toEqual({ id: '1', type: 'ping' })
  })

  it('handles trailing whitespace', () => {
    const result = decode('  {"type":"data","sessionId":"s1","data":"x"}  ')
    expect(result).toEqual({ type: 'data', sessionId: 's1', data: 'x' })
  })

  it('returns null for empty input', () => {
    expect(decode('')).toBeNull()
    expect(decode('   ')).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(decode('not json')).toBeNull()
    expect(decode('{broken')).toBeNull()
  })

  it('roundtrips with encode', () => {
    const msg = { id: 'req-42', type: 'ok' as const, data: { sessions: [] } }
    const encoded = encode(msg)
    const decoded = decode(encoded)
    expect(decoded).toEqual(msg)
  })
})
