// Mock expo-crypto's RNG with a deterministic-but-varying source so the test is
// independent of jest-expo's native module stubs (which may return constant
// bytes). e2ee.ts wires this into tweetnacl via nacl.setPRNG at import time.
jest.mock('expo-crypto', () => {
  let seed = 1;
  return {
    getRandomBytes: (len: number) => {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        out[i] = seed & 0xff;
      }
      return out;
    },
  };
});

import {
  deriveSharedKey,
  generateKeyPair,
  openBytes,
  openJson,
  sealBytes,
  sealJson,
} from '../e2ee';

// Mirrors the desktop suite in src/main/services/mobileServer/__tests__/e2ee.test.ts.
// The random-nonce ("sealed") scheme is the fix for the lockstep-counter desync
// that froze the mobile terminal: every frame carries its own nonce, so decoding
// is stateless and order-independent and the JSON/binary channels can't desync.

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('mobile e2ee (random-nonce scheme)', () => {
  it('sealBytes round-trips across parties', () => {
    const server = generateKeyPair();
    const client = generateKeyPair();
    const serverShared = deriveSharedKey(server.secretKey, client.publicKey);
    const clientShared = deriveSharedKey(client.secretKey, server.publicKey);

    const sealed = sealBytes(enc('hello world'), serverShared);
    const opened = openBytes(sealed, clientShared);
    expect(opened).not.toBeNull();
    expect(dec(opened!)).toBe('hello world');
  });

  it('decrypts frames in ANY order (no lockstep counter)', () => {
    const server = generateKeyPair();
    const client = generateKeyPair();
    const serverShared = deriveSharedKey(server.secretKey, client.publicKey);
    const clientShared = deriveSharedKey(client.secretKey, server.publicKey);

    const a = sealBytes(enc('first'), serverShared);
    const b = sealBytes(enc('second'), serverShared);
    const c = sealBytes(enc('third'), serverShared);

    // Open out of order - all still succeed, because each frame self-describes
    // its nonce. This is the property that prevents the terminal-freeze bug.
    expect(dec(openBytes(c, clientShared)!)).toBe('third');
    expect(dec(openBytes(a, clientShared)!)).toBe('first');
    expect(dec(openBytes(b, clientShared)!)).toBe('second');
  });

  it('uses a fresh nonce per call (same plaintext seals differently)', () => {
    const shared = deriveSharedKey(generateKeyPair().secretKey, generateKeyPair().publicKey);
    const one = sealBytes(enc('repeat'), shared);
    const two = sealBytes(enc('repeat'), shared);
    expect(Array.from(one)).not.toEqual(Array.from(two));
  });

  it('returns null for a tampered bundle', () => {
    const server = generateKeyPair();
    const client = generateKeyPair();
    const serverShared = deriveSharedKey(server.secretKey, client.publicKey);
    const clientShared = deriveSharedKey(client.secretKey, server.publicKey);
    const sealed = sealBytes(enc('secret'), serverShared);
    sealed[sealed.length - 1] ^= 0xff;
    expect(openBytes(sealed, clientShared)).toBeNull();
  });

  it('returns null for a truncated bundle', () => {
    const shared = deriveSharedKey(generateKeyPair().secretKey, generateKeyPair().publicKey);
    expect(openBytes(new Uint8Array(8), shared)).toBeNull();
  });

  it('sealJson / openJson round-trip a JSON object', () => {
    const server = generateKeyPair();
    const client = generateKeyPair();
    const serverShared = deriveSharedKey(server.secretKey, client.publicKey);
    const clientShared = deriveSharedKey(client.secretKey, server.publicKey);

    const data = { jsonrpc: '2.0', method: 'terminal.data', params: { ptyId: 'p', data: 'x' } };
    expect(openJson(sealJson(data, serverShared), clientShared)).toEqual(data);
  });

  it('openJson returns null for tampered ciphertext', () => {
    const shared = deriveSharedKey(generateKeyPair().secretKey, generateKeyPair().publicKey);
    const sealed = sealJson({ test: true }, shared);
    expect(openJson(sealed.slice(0, -4) + 'AAAA', shared)).toBeNull();
  });
});
