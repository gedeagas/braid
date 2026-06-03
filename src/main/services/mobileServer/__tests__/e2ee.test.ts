import { describe, it, expect } from 'vitest'
import {
  generateKeyPair,
  deriveSharedKey,
  sealBytes,
  openBytes,
  sealJson,
  openJson,
  toBase64,
  fromBase64,
} from '../e2ee'
import nacl from 'tweetnacl'

describe('E2EE', () => {
  describe('generateKeyPair', () => {
    it('generates a valid NaCl box keypair', () => {
      const kp = generateKeyPair()
      expect(kp.publicKey).toBeInstanceOf(Uint8Array)
      expect(kp.secretKey).toBeInstanceOf(Uint8Array)
      expect(kp.publicKey.length).toBe(nacl.box.publicKeyLength) // 32
      expect(kp.secretKey.length).toBe(nacl.box.secretKeyLength) // 32
    })

    it('generates unique keypairs', () => {
      const kp1 = generateKeyPair()
      const kp2 = generateKeyPair()
      expect(toBase64(kp1.publicKey)).not.toBe(toBase64(kp2.publicKey))
    })
  })

  describe('deriveSharedKey', () => {
    it('derives matching shared keys for both parties', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const serverShared = deriveSharedKey(server.secretKey, client.publicKey)
      const clientShared = deriveSharedKey(client.secretKey, server.publicKey)
      expect(toBase64(serverShared)).toBe(toBase64(clientShared))
    })
  })

  describe('sealBytes / openBytes (random-nonce scheme)', () => {
    it('round-trips bytes across parties', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const serverShared = deriveSharedKey(server.secretKey, client.publicKey)
      const clientShared = deriveSharedKey(client.secretKey, server.publicKey)

      const plaintext = new TextEncoder().encode('hello world')
      const sealed = sealBytes(plaintext, serverShared)
      // 24-byte nonce prefix + MAC overhead.
      expect(sealed.length).toBe(24 + plaintext.length + nacl.box.overheadLength)

      const opened = openBytes(sealed, clientShared)
      expect(opened).not.toBeNull()
      expect(new TextDecoder().decode(opened!)).toBe('hello world')
    })

    it('uses a fresh random nonce per call (same plaintext seals differently)', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const sharedKey = deriveSharedKey(server.secretKey, client.publicKey)
      const plaintext = new TextEncoder().encode('repeat')
      expect(toBase64(sealBytes(plaintext, sharedKey))).not.toBe(toBase64(sealBytes(plaintext, sharedKey)))
    })

    it('decrypts frames in ANY order (no lockstep counter)', () => {
      // The whole point of the random-nonce scheme: a reordered or dropped frame
      // never desyncs the stream, because each frame carries its own nonce.
      const server = generateKeyPair()
      const client = generateKeyPair()
      const serverShared = deriveSharedKey(server.secretKey, client.publicKey)
      const clientShared = deriveSharedKey(client.secretKey, server.publicKey)

      const a = sealBytes(new TextEncoder().encode('first'), serverShared)
      const b = sealBytes(new TextEncoder().encode('second'), serverShared)
      const c = sealBytes(new TextEncoder().encode('third'), serverShared)

      // Open out of order - all still succeed (no counter to fall behind).
      expect(new TextDecoder().decode(openBytes(c, clientShared)!)).toBe('third')
      expect(new TextDecoder().decode(openBytes(a, clientShared)!)).toBe('first')
      expect(new TextDecoder().decode(openBytes(b, clientShared)!)).toBe('second')
    })

    it('returns null for a tampered bundle', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const serverShared = deriveSharedKey(server.secretKey, client.publicKey)
      const clientShared = deriveSharedKey(client.secretKey, server.publicKey)
      const sealed = sealBytes(new TextEncoder().encode('secret'), serverShared)
      sealed[sealed.length - 1] ^= 0xff
      expect(openBytes(sealed, clientShared)).toBeNull()
    })

    it('returns null for a truncated bundle (shorter than nonce + MAC)', () => {
      const sharedKey = deriveSharedKey(generateKeyPair().secretKey, generateKeyPair().publicKey)
      expect(openBytes(new Uint8Array(8), sharedKey)).toBeNull()
    })
  })

  describe('sealJson / openJson (random-nonce scheme)', () => {
    it('round-trips a JSON object across parties', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const serverShared = deriveSharedKey(server.secretKey, client.publicKey)
      const clientShared = deriveSharedKey(client.secretKey, server.publicKey)

      const data = { method: 'status.get', params: { foo: 42 } }
      const sealed = sealJson(data, serverShared)
      expect(typeof sealed).toBe('string') // base64
      expect(openJson(sealed, clientShared)).toEqual(data)
    })

    it('returns null for tampered ciphertext', () => {
      const sharedKey = deriveSharedKey(generateKeyPair().secretKey, generateKeyPair().publicKey)
      const sealed = sealJson({ test: true }, sharedKey)
      expect(openJson(sealed.slice(0, -4) + 'AAAA', sharedKey)).toBeNull()
    })
  })

  describe('toBase64 / fromBase64', () => {
    it('round-trips bytes', () => {
      const original = new Uint8Array([1, 2, 3, 255, 0])
      const b64 = toBase64(original)
      const restored = fromBase64(b64)
      expect(Array.from(restored)).toEqual(Array.from(original))
    })
  })
})
