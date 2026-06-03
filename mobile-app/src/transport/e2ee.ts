import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

import { fromBase64, toBase64 } from './encoding';

nacl.setPRNG((target, count) => {
  const bytes = Crypto.getRandomBytes(count);
  for (let i = 0; i < count; i += 1) target[i] = bytes[i];
});

export function generateKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair();
}

export function deriveSharedKey(localSecretKey: Uint8Array, remotePublicKey: Uint8Array): Uint8Array {
  return nacl.box.before(remotePublicKey, localSecretKey);
}

// Framing: every message is a self-describing `[24-byte random nonce][ciphertext]`
// bundle. A fresh random nonce per message means decryption is stateless and
// order-independent - there is no counter both sides must keep in lockstep, so a
// dropped, reordered, or out-of-order frame can never desync the stream (the
// failure mode that silently froze the terminal). The JSON text channel and the
// binary terminal channel are fully independent. Mirror of the desktop's
// `src/main/services/mobileServer/e2ee.ts`.

const NONCE_BYTES = nacl.box.nonceLength; // 24

/** Seal bytes into a self-describing `[nonce][ciphertext]` bundle. */
export function sealBytes(plaintext: Uint8Array, sharedKey: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(NONCE_BYTES);
  const ciphertext = nacl.box.after(plaintext, nonce, sharedKey);
  const bundle = new Uint8Array(NONCE_BYTES + ciphertext.length);
  bundle.set(nonce, 0);
  bundle.set(ciphertext, NONCE_BYTES);
  return bundle;
}

/** Open a `[nonce][ciphertext]` bundle; returns null on truncation / bad MAC. */
export function openBytes(bundle: Uint8Array, sharedKey: Uint8Array): Uint8Array | null {
  if (bundle.length < NONCE_BYTES + nacl.box.overheadLength) return null;
  const nonce = bundle.subarray(0, NONCE_BYTES);
  const ciphertext = bundle.subarray(NONCE_BYTES);
  return nacl.box.open.after(ciphertext, nonce, sharedKey);
}

/** Seal a JSON value into a base64 string for a WebSocket text frame. */
export function sealJson(data: unknown, sharedKey: Uint8Array): string {
  return toBase64(sealBytes(new TextEncoder().encode(JSON.stringify(data)), sharedKey));
}

/** Open a base64 bundle from sealJson back to a JSON value, or null. */
export function openJson<T>(payload: string, sharedKey: Uint8Array): T | null {
  try {
    const opened = openBytes(fromBase64(payload), sharedKey);
    if (!opened) return null;
    return JSON.parse(new TextDecoder().decode(opened)) as T;
  } catch {
    return null;
  }
}

export { fromBase64, toBase64 };
