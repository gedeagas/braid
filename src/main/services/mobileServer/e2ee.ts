import nacl from 'tweetnacl'

/**
 * E2EE layer using tweetnacl (NaCl box = Curve25519 + XSalsa20-Poly1305).
 *
 * Handshake:
 * 1. Mobile sends plaintext: { type: "e2ee_hello", ephemeralPublicKey, deviceToken }
 * 2. Server generates ephemeral keypair, derives shared key
 *    Sends plaintext: { type: "e2ee_ready", serverEphemeralPublicKey }
 * 3. All subsequent messages are NaCl box encrypted
 *
 * Nonce space is partitioned: server uses even counters, client uses odd,
 * preventing nonce reuse from both sides.
 */

export function generateKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair()
}

/**
 * Derive a shared key for nacl.box.open/nacl.box using ECDH.
 * Uses nacl.box.before() to precompute the shared key for efficiency.
 */
export function deriveSharedKey(
  localSecretKey: Uint8Array,
  remotePublicKey: Uint8Array
): Uint8Array {
  return nacl.box.before(remotePublicKey, localSecretKey)
}

/**
 * Generate a 24-byte nonce from a counter value.
 * Server uses even counters (counter * 2), mobile uses odd (counter * 2 + 1).
 * This prevents nonce collision between the two sides.
 */
export function generateNonce(counter: number, isServer: boolean): Uint8Array {
  const nonce = new Uint8Array(nacl.box.nonceLength) // 24 bytes
  // Write the partitioned counter as a big-endian 64-bit value at the end of the nonce
  const value = counter * 2 + (isServer ? 0 : 1)
  const view = new DataView(nonce.buffer)
  // Use two 32-bit writes for the 64-bit value (high bits at offset 16, low bits at offset 20)
  view.setUint32(16, Math.floor(value / 0x100000000))
  view.setUint32(20, value >>> 0)
  return nonce
}

/**
 * Encrypt a plaintext message using the precomputed shared key.
 * Returns the ciphertext (includes the Poly1305 MAC tag).
 */
export function encrypt(
  plaintext: Uint8Array,
  sharedKey: Uint8Array,
  nonce: Uint8Array
): Uint8Array {
  return nacl.box.after(plaintext, nonce, sharedKey)
}

/**
 * Decrypt a ciphertext message using the precomputed shared key.
 * Returns null if authentication fails (tampered or wrong key).
 */
export function decrypt(
  ciphertext: Uint8Array,
  sharedKey: Uint8Array,
  nonce: Uint8Array
): Uint8Array | null {
  return nacl.box.open.after(ciphertext, nonce, sharedKey)
}

/**
 * Encrypt a JSON object, returning a base64-encoded string ready for WebSocket.
 * @param isServer - true if the server is encrypting, false if the client is encrypting
 */
export function encryptJson(
  data: unknown,
  sharedKey: Uint8Array,
  counter: number,
  isServer = true
): { encrypted: string; nextCounter: number } {
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const nonce = generateNonce(counter, isServer)
  const ciphertext = encrypt(plaintext, sharedKey, nonce)
  return {
    encrypted: Buffer.from(ciphertext).toString('base64'),
    nextCounter: counter + 1,
  }
}

/**
 * Decrypt a base64-encoded encrypted message back to a JSON object.
 * Returns null if decryption or JSON parse fails.
 * @param senderIsServer - true if the message was encrypted by the server, false if by the client
 */
export function decryptJson<T = unknown>(
  encrypted: string,
  sharedKey: Uint8Array,
  counter: number,
  senderIsServer = true
): { data: T; nextCounter: number } | null {
  try {
    const ciphertext = Buffer.from(encrypted, 'base64')
    // Use the same nonce the sender used to encrypt
    const nonce = generateNonce(counter, senderIsServer)
    const plaintext = decrypt(new Uint8Array(ciphertext), sharedKey, nonce)
    if (!plaintext) return null
    const data = JSON.parse(new TextDecoder().decode(plaintext)) as T
    return { data, nextCounter: counter + 1 }
  } catch {
    return null
  }
}

/** Encode a Uint8Array to base64 string. */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** Decode a base64 string to Uint8Array. */
export function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'))
}
