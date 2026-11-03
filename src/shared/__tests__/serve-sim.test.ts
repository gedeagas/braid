import { describe, expect, it } from 'vitest'
import { isServeSimUrl, parseServeSimLocalUrl } from '../serve-sim'

describe('isServeSimUrl', () => {
  it('accepts loopback http URLs with an explicit port', () => {
    expect(isServeSimUrl('http://127.0.0.1:3200')).toBe(true)
    expect(isServeSimUrl('http://127.0.0.1:3201/?device=ABC')).toBe(true)
    expect(isServeSimUrl('http://localhost:3200/')).toBe(true)
  })

  it('rejects non-loopback hosts, other schemes, and portless URLs', () => {
    expect(isServeSimUrl('http://192.168.1.4:3200')).toBe(false)
    expect(isServeSimUrl('https://127.0.0.1:3200')).toBe(false)
    expect(isServeSimUrl('file:///tmp/index.html')).toBe(false)
    expect(isServeSimUrl('http://127.0.0.1')).toBe(false)
    expect(isServeSimUrl('http://localhost.evil.com:3200')).toBe(false)
    expect(isServeSimUrl('not a url')).toBe(false)
  })
})

describe('parseServeSimLocalUrl', () => {
  it('extracts the preview URL from serve-sim startup output', () => {
    const out = '\n  - Local:   http://localhost:3201\n  - Network: \x1B[2muse --host 0.0.0.0\x1B[0m\n'
    expect(parseServeSimLocalUrl(out)).toBe('http://127.0.0.1:3201')
  })

  it('returns null until the Local line is printed', () => {
    expect(parseServeSimLocalUrl('Starting simulator stream...\n')).toBeNull()
  })
})
