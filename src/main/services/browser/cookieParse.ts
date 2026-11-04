// Pure cookie parsing/decryption helpers for profile cookie import (tested in isolation).
import { createDecipheriv, pbkdf2Sync } from 'crypto'

export interface ImportedCookie {
  domain: string
  name: string
  value: string
  path: string
  secure: boolean
  httpOnly: boolean
  /** Unix seconds; undefined = session cookie. */
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/** Google sign-in can't be imported (Google rejects replayed sessions in embedded browsers). */
export function isGoogleDomain(domain: string): boolean {
  const host = domain.replace(/^\./, '').toLowerCase()
  return /(^|\.)google\.[a-z.]{2,6}$/.test(host) || /(^|\.)(googleapis|gstatic|youtube|accounts\.youtube)\.com$/.test(host)
}

/** Netscape cookies.txt (as exported by browser extensions and curl). */
export function parseNetscapeCookies(text: string): ImportedCookie[] {
  const out: ImportedCookie[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    let httpOnly = false
    if (line.startsWith('#HttpOnly_')) { httpOnly = true; line = line.slice('#HttpOnly_'.length) }
    else if (line.startsWith('#')) continue
    const parts = line.split('\t')
    if (parts.length < 7) continue
    const [domain, , path, secure, expiry, name, ...valueParts] = parts
    const exp = Number(expiry)
    out.push({
      domain, name, value: valueParts.join('\t'), path: path || '/',
      secure: secure.toUpperCase() === 'TRUE', httpOnly,
      expirationDate: Number.isFinite(exp) && exp > 0 ? exp : undefined,
    })
  }
  return out
}

/** JSON export (array of cookie objects, e.g. from "EditThisCookie"/Cookie-Editor or Puppeteer). */
export function parseJsonCookies(text: string): ImportedCookie[] {
  const parsed = JSON.parse(text) as unknown
  const list = Array.isArray(parsed) ? parsed : (parsed as { cookies?: unknown[] })?.cookies
  if (!Array.isArray(list)) throw new Error('Expected a JSON array of cookies')
  const sameSiteMap: Record<string, ImportedCookie['sameSite']> = {
    no_restriction: 'no_restriction', none: 'no_restriction', lax: 'lax', strict: 'strict', unspecified: 'unspecified',
  }
  return list.flatMap((c): ImportedCookie[] => {
    if (typeof c !== 'object' || c === null) return []
    const r = c as Record<string, unknown>
    if (typeof r.name !== 'string' || typeof r.domain !== 'string') return []
    const exp = Number(r.expirationDate ?? r.expires)
    return [{
      domain: r.domain, name: r.name, value: String(r.value ?? ''), path: typeof r.path === 'string' ? r.path : '/',
      secure: Boolean(r.secure), httpOnly: Boolean(r.httpOnly),
      expirationDate: Number.isFinite(exp) && exp > 0 ? exp : undefined,
      sameSite: typeof r.sameSite === 'string' ? sameSiteMap[r.sameSite.toLowerCase()] : undefined,
    }]
  })
}

export function parseCookieFile(text: string): ImportedCookie[] {
  const trimmed = text.trim()
  return trimmed.startsWith('[') || trimmed.startsWith('{') ? parseJsonCookies(trimmed) : parseNetscapeCookies(trimmed)
}

// ─── Chromium (Chrome / Edge) on macOS ───────────────────────────────────────

export function chromiumKey(keychainPassword: string): Buffer {
  return pbkdf2Sync(keychainPassword, 'saltysalt', 1003, 16, 'sha1')
}

/**
 * Decrypt a Chromium `encrypted_value`: "v10" + AES-128-CBC (IV = 16 spaces).
 * Cookie DB schema >= 24 prefixes the plaintext with SHA-256(host_key).
 */
export function decryptChromiumValue(encrypted: Buffer, key: Buffer, dbVersion: number): string {
  if (encrypted.length === 0) return ''
  const prefix = encrypted.subarray(0, 3).toString('latin1')
  if (prefix !== 'v10' && prefix !== 'v11') return encrypted.toString('utf8')
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
  let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
  if (dbVersion >= 24 && plain.length >= 32) plain = plain.subarray(32)
  return plain.toString('utf8')
}

/** Chromium stores expiry as microseconds since 1601-01-01; 0 = session cookie. */
export function chromiumExpiryToUnix(expiresUtc: number | bigint): number | undefined {
  const micros = Number(expiresUtc)
  if (!micros) return undefined
  return Math.floor(micros / 1_000_000 - 11_644_473_600)
}

export function chromiumSameSite(value: number): ImportedCookie['sameSite'] {
  return value === 0 ? 'no_restriction' : value === 1 ? 'lax' : value === 2 ? 'strict' : 'unspecified'
}
