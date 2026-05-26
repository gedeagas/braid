import { describe, it, expect } from 'vitest'
import {
  generateKeyPair,
  deriveSharedKey,
  generateNonce,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
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

  describe('generateNonce', () => {
    it('produces 24-byte nonces', () => {
      const nonce = generateNonce(0, true)
      expect(nonce.length).toBe(24)
    })

    it('server and client nonces differ for same counter', () => {
      const serverNonce = generateNonce(0, true)
      const clientNonce = generateNonce(0, false)
      expect(toBase64(serverNonce)).not.toBe(toBase64(clientNonce))
    })

    it('different counters produce different nonces', () => {
      const n1 = generateNonce(0, true)
      const n2 = generateNonce(1, true)
      expect(toBase64(n1)).not.toBe(toBase64(n2))
    })
  })

  describe('encrypt / decrypt', () => {
    it('round-trips a message', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const sharedKey = deriveSharedKey(server.secretKey, client.publicKey)

      const plaintext = new TextEncoder().encode('hello world')
      const nonce = generateNonce(0, true)
      const ciphertext = encrypt(plaintext, sharedKey, nonce)
      expect(ciphertext.length).toBeGreaterThan(plaintext.length) // MAC overhead

      // Decrypt with same shared key (derived from other side)
      const clientShared = deriveSharedKey(client.secretKey, server.publicKey)
      const decrypted = decrypt(ciphertext, clientShared, nonce)
      expect(decrypted).not.toBeNull()
      expect(new TextDecoder().decode(decrypted!)).toBe('hello world')
    })

    it('fails with wrong key', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const sharedKey = deriveSharedKey(server.secretKey, client.publicKey)

      const plaintext = new TextEncoder().encode('secret')
      const nonce = generateNonce(0, true)
      const ciphertext = encrypt(plaintext, sharedKey, nonce)

      // Try to decrypt with a different shared key
      const wrongKey = deriveSharedKey(generateKeyPair().secretKey, generateKeyPair().publicKey)
      expect(decrypt(ciphertext, wrongKey, nonce)).toBeNull()
    })

    it('fails with wrong nonce', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const sharedKey = deriveSharedKey(server.secretKey, client.publicKey)

      const plaintext = new TextEncoder().encode('secret')
      const nonce = generateNonce(0, true)
      const ciphertext = encrypt(plaintext, sharedKey, nonce)

      const wrongNonce = generateNonce(1, true)
      expect(decrypt(ciphertext, sharedKey, wrongNonce)).toBeNull()
    })
  })

  describe('encryptJson / decryptJson', () => {
    it('round-trips a JSON object', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const serverShared = deriveSharedKey(server.secretKey, client.publicKey)
      const clientShared = deriveSharedKey(client.secretKey, server.publicKey)

      const data = { method: 'status.get', params: { foo: 42 } }
      const { encrypted, nextCounter } = encryptJson(data, serverShared, 0)
      expect(nextCounter).toBe(1)
      expect(typeof encrypted).toBe('string') // base64

      // Client decrypts (counter 0, sender was server)
      const result = decryptJson(encrypted, clientShared, 0, true)
      expect(result).not.toBeNull()
      expect(result!.data).toEqual(data)
      expect(result!.nextCounter).toBe(1)
    })

    it('returns null for tampered ciphertext', () => {
      const server = generateKeyPair()
      const client = generateKeyPair()
      const sharedKey = deriveSharedKey(server.secretKey, client.publicKey)

      const { encrypted } = encryptJson({ test: true }, sharedKey, 0)
      const tampered = encrypted.slice(0, -4) + 'AAAA'
      const clientShared = deriveSharedKey(client.secretKey, server.publicKey)
      expect(decryptJson(tampered, clientShared, 0, true)).toBeNull()
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
