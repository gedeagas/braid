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

function nonceFor(counter: number, senderIsServer: boolean): Uint8Array {
  const nonce = new Uint8Array(nacl.box.nonceLength);
  const value = counter * 2 + (senderIsServer ? 0 : 1);
  const view = new DataView(nonce.buffer);
  view.setUint32(16, Math.floor(value / 0x100000000));
  view.setUint32(20, value >>> 0);
  return nonce;
}

export function encryptJson(data: unknown, sharedKey: Uint8Array, counter: number, senderIsServer: boolean): string {
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = nacl.box.after(plaintext, nonceFor(counter, senderIsServer), sharedKey);
  return toBase64(encrypted);
}

export function decryptJson<T>(payload: string, sharedKey: Uint8Array, counter: number, senderIsServer: boolean): T {
  const plaintext = nacl.box.open.after(fromBase64(payload), nonceFor(counter, senderIsServer), sharedKey);
  if (!plaintext) throw new Error('Unable to decrypt server message');
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export { fromBase64, toBase64 };
