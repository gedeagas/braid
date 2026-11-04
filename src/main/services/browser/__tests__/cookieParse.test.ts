import { describe, it, expect } from 'vitest'
import { createCipheriv, createHash } from 'crypto'
import {
  chromiumExpiryToUnix,
  chromiumKey,
  decryptChromiumValue,
  isGoogleDomain,
  parseCookieFile,
} from '../cookieParse'

function encrypt(plain: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()])
}

describe('parseCookieFile', () => {
  it('parses Netscape cookies.txt including HttpOnly lines', () => {
    const txt = [
      '# Netscape HTTP Cookie File',
      '.example.com\tTRUE\t/\tTRUE\t1900000000\tsid\tabc\tdef',
      '#HttpOnly_app.test\tFALSE\t/api\tFALSE\t0\ttoken\tx',
      'garbage',
    ].join('\n')
    expect(parseCookieFile(txt)).toEqual([
      { domain: '.example.com', name: 'sid', value: 'abc\tdef', path: '/', secure: true, httpOnly: false, expirationDate: 1900000000 },
      { domain: 'app.test', name: 'token', value: 'x', path: '/api', secure: false, httpOnly: true, expirationDate: undefined },
    ])
  })

  it('parses JSON exports', () => {
    const json = JSON.stringify([{ name: 'a', value: '1', domain: '.x.com', path: '/', secure: true, httpOnly: true, expirationDate: 2000000000.5, sameSite: 'Lax' }, { nope: 1 }])
    expect(parseCookieFile(json)).toEqual([
      { domain: '.x.com', name: 'a', value: '1', path: '/', secure: true, httpOnly: true, expirationDate: 2000000000.5, sameSite: 'lax' },
    ])
  })
})

describe('isGoogleDomain', () => {
  it('matches Google sign-in domains only', () => {
    expect(isGoogleDomain('.google.com')).toBe(true)
    expect(isGoogleDomain('accounts.google.co.jp')).toBe(true)
    expect(isGoogleDomain('.youtube.com')).toBe(true)
    expect(isGoogleDomain('notgoogle.com')).toBe(false)
    expect(isGoogleDomain('github.com')).toBe(false)
  })
})

describe('decryptChromiumValue', () => {
  const key = chromiumKey('test-password')

  it('decrypts v10 values', () => {
    expect(decryptChromiumValue(encrypt(Buffer.from('hello'), key), key, 20)).toBe('hello')
  })

  it('strips the host hash prefix on schema >= 24', () => {
    const hash = createHash('sha256').update('.example.com').digest()
    const enc = encrypt(Buffer.concat([hash, Buffer.from('secret')]), key)
    expect(decryptChromiumValue(enc, key, 24)).toBe('secret')
  })

  it('returns plaintext values as-is', () => {
    expect(decryptChromiumValue(Buffer.from('plain'), key, 24)).toBe('plain')
    expect(decryptChromiumValue(Buffer.alloc(0), key, 24)).toBe('')
  })
})

describe('chromiumExpiryToUnix', () => {
  it('converts from the 1601 epoch', () => {
    expect(chromiumExpiryToUnix(0)).toBeUndefined()
    expect(chromiumExpiryToUnix(13_300_000_000_000_000n)).toBe(1_655_526_400)
  })
})
