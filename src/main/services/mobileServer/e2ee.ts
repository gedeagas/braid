import nacl from 'tweetnacl'

/**
 * E2EE layer using tweetnacl (NaCl box = Curve25519 + XSalsa20-Poly1305).
 *
 * Handshake:
 * 1. Mobile sends plaintext: { type: "e2ee_hello", ephemeralPublicKey }
 * 2. Server generates ephemeral keypair, derives shared key
 *    Sends plaintext: { type: "e2ee_ready", serverEphemeralPublicKey }
 * 3. Mobile sends a sealed auth (see sealJson), including its deviceToken.
 * 4. All subsequent messages are sealed NaCl boxes (see below).
 *
 * Framing: every message is a self-describing `[24-byte random nonce][ciphertext]`
 * bundle. A fresh random nonce per message means decryption is stateless and
 * order-independent - there is no counter both sides must keep in lockstep, so a
 * dropped, reordered, or send-skipped frame can never desync the stream (the
 * failure mode that silently froze the mobile terminal). The JSON text channel
 * and the binary terminal channel are fully independent: a hiccup on one cannot
 * corrupt the other. XSalsa20's 24-byte nonce is wide enough that random
 * collisions are negligible. Keep in sync with `mobile-app/src/transport/e2ee.ts`.
 */

const NONCE_BYTES = nacl.box.nonceLength // 24

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
 * Encrypt bytes into a self-describing `[nonce][ciphertext]` bundle using a
 * fresh random nonce. The bundle carries everything {@link openBytes} needs.
 */
export function sealBytes(plaintext: Uint8Array, sharedKey: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(NONCE_BYTES)
  const ciphertext = nacl.box.after(plaintext, nonce, sharedKey)
  const bundle = new Uint8Array(NONCE_BYTES + ciphertext.length)
  bundle.set(nonce, 0)
  bundle.set(ciphertext, NONCE_BYTES)
  return bundle
}

/**
 * Open a `[nonce][ciphertext]` bundle produced by {@link sealBytes}. Returns
 * null on a truncated bundle or failed authentication, so callers can drop a
 * single bad frame without tearing down the session.
 */
export function openBytes(bundle: Uint8Array, sharedKey: Uint8Array): Uint8Array | null {
  if (bundle.length < NONCE_BYTES + nacl.box.overheadLength) return null
  const nonce = bundle.subarray(0, NONCE_BYTES)
  const ciphertext = bundle.subarray(NONCE_BYTES)
  return nacl.box.open.after(ciphertext, nonce, sharedKey)
}

/** Seal a JSON value into a base64 string ready for a WebSocket text frame. */
export function sealJson(data: unknown, sharedKey: Uint8Array): string {
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  return Buffer.from(sealBytes(plaintext, sharedKey)).toString('base64')
}

/** Open a base64 bundle from {@link sealJson} back to a JSON value, or null. */
export function openJson<T = unknown>(payload: string, sharedKey: Uint8Array): T | null {
  try {
    const opened = openBytes(new Uint8Array(Buffer.from(payload, 'base64')), sharedKey)
    if (!opened) return null
    return JSON.parse(new TextDecoder().decode(opened)) as T
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
