import { Buffer } from 'buffer';

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export function encodeJsonBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function decodeJsonBase64<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T;
}
