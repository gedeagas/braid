// Cookie import into a browser profile: from a cookie file, or from Chrome /
// Edge on macOS (decrypted with the browser's Keychain "Safe Storage" key -
// macOS asks the user to allow access). Only domains present in the import
// are replaced, so unrelated sign-ins in the profile survive. Google cookies
// are never imported.
import { app, type Session } from 'electron'
import { execFile } from 'child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import {
  chromiumExpiryToUnix,
  chromiumKey,
  chromiumSameSite,
  decryptChromiumValue,
  isGoogleDomain,
  parseCookieFile,
  type ImportedCookie,
} from './cookieParse'
import type { BrowserCookieImportResult } from '../../../shared/browser'

export type ChromiumBrowser = 'chrome' | 'edge'

const BROWSERS: Record<ChromiumBrowser, { dir: string; keychainService: string; label: string }> = {
  chrome: { dir: 'Google/Chrome', keychainService: 'Chrome Safe Storage', label: 'Chrome' },
  edge: { dir: 'Microsoft Edge', keychainService: 'Microsoft Edge Safe Storage', label: 'Edge' },
}

export type CookieImportResult = BrowserCookieImportResult

export interface ChromiumProfileOption {
  browser: ChromiumBrowser
  profileDir: string
  label: string
}

function browserRoot(browser: ChromiumBrowser): string {
  return join(homedir(), 'Library', 'Application Support', BROWSERS[browser].dir)
}

/** Chromium profiles that have a cookie store (only called when the user opens the import menu). */
export function listChromiumProfiles(): ChromiumProfileOption[] {
  if (process.platform !== 'darwin') return []
  const out: ChromiumProfileOption[] = []
  for (const browser of Object.keys(BROWSERS) as ChromiumBrowser[]) {
    const root = browserRoot(browser)
    if (!existsSync(root)) continue
    let names: Record<string, string> = {}
    try {
      const state = JSON.parse(readFileSync(join(root, 'Local State'), 'utf8')) as { profile?: { info_cache?: Record<string, { name?: string }> } }
      names = Object.fromEntries(Object.entries(state.profile?.info_cache ?? {}).map(([k, v]) => [k, v.name ?? k]))
    } catch { /* fall back to directory names */ }
    for (const entry of readdirSync(root)) {
      if (entry !== 'Default' && !/^Profile \d+$/.test(entry)) continue
      const hasCookies = existsSync(join(root, entry, 'Network', 'Cookies')) || existsSync(join(root, entry, 'Cookies'))
      if (hasCookies) out.push({ browser, profileDir: entry, label: `${BROWSERS[browser].label} - ${names[entry] ?? entry}` })
    }
  }
  return out
}

function keychainPassword(service: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-w', '-s', service], { timeout: 60_000 }, (err, stdout) => {
      if (err) reject(new Error(`Keychain access to "${service}" was denied or not found`))
      else resolve(stdout.trim())
    })
  })
}

interface ChromiumRow {
  host_key: string; name: string; value: string; encrypted_value: Uint8Array; path: string
  expires_utc: number | bigint; is_secure: number; is_httponly: number; samesite: number
}

async function readChromiumCookies(browser: ChromiumBrowser, profileDir: string): Promise<ImportedCookie[]> {
  if (process.platform !== 'darwin') throw new Error('Browser cookie import is only supported on macOS')
  const root = join(browserRoot(browser), profileDir)
  const dbPath = [join(root, 'Network', 'Cookies'), join(root, 'Cookies')].find(existsSync)
  if (!dbPath) throw new Error(`No cookie store for ${BROWSERS[browser].label} ${profileDir}`)
  const key = chromiumKey(await keychainPassword(BROWSERS[browser].keychainService))
  // The live database is locked while the browser runs; read a copy.
  const copy = join(tmpdir(), `braid-cookies-${process.pid}-${Date.now()}.sqlite`)
  copyFileSync(dbPath, copy)
  try {
    let sqlite: typeof import('node:sqlite')
    try { sqlite = await import('node:sqlite') } catch { throw new Error('This Braid build cannot read browser databases (node:sqlite unavailable)') }
    const db = new sqlite.DatabaseSync(copy, { readOnly: true })
    try {
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value?: string } | undefined
      const version = Number(meta?.value ?? 0)
      const rows = db.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies').all() as unknown as ChromiumRow[]
      return rows.flatMap((r): ImportedCookie[] => {
        try {
          const value = r.value || decryptChromiumValue(Buffer.from(r.encrypted_value ?? []), key, version)
          return [{
            domain: r.host_key, name: r.name, value, path: r.path || '/',
            secure: r.is_secure === 1, httpOnly: r.is_httponly === 1,
            expirationDate: chromiumExpiryToUnix(r.expires_utc), sameSite: chromiumSameSite(Number(r.samesite)),
          }]
        } catch { return [] }
      })
    } finally {
      db.close()
    }
  } finally {
    rmSync(copy, { force: true })
  }
}

async function applyCookies(sess: Session, cookies: ImportedCookie[]): Promise<CookieImportResult> {
  const kept = cookies.filter((c) => !isGoogleDomain(c.domain))
  const skippedGoogle = cookies.length - kept.length
  const now = Date.now() / 1000
  const live = kept.filter((c) => !c.expirationDate || c.expirationDate > now)
  const domains = new Set(live.map((c) => c.domain.replace(/^\./, '').toLowerCase()))
  // Replace only the imported domains.
  for (const domain of domains) {
    const existing = await sess.cookies.get({ domain })
    for (const c of existing) {
      const host = (c.domain ?? domain).replace(/^\./, '')
      await sess.cookies.remove(`${c.secure ? 'https' : 'http'}://${host}${c.path ?? '/'}`, c.name).catch(() => {})
    }
  }
  let imported = 0
  let failed = 0
  for (const c of live) {
    const host = c.domain.replace(/^\./, '')
    try {
      await sess.cookies.set({
        url: `${c.secure ? 'https' : 'http'}://${host}${c.path}`,
        name: c.name, value: c.value, path: c.path,
        domain: c.domain.startsWith('.') ? c.domain : undefined,
        secure: c.secure, httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
        sameSite: c.sameSite,
      })
      imported++
    } catch {
      failed++
    }
  }
  await sess.cookies.flushStore().catch(() => {})
  return { imported, skippedGoogle, failed, domains: domains.size }
}

export async function importCookieFile(sess: Session, filePath: string): Promise<CookieImportResult> {
  return applyCookies(sess, parseCookieFile(readFileSync(filePath, 'utf8')))
}

export async function importChromiumCookies(sess: Session, browser: ChromiumBrowser, profileDir: string): Promise<CookieImportResult> {
  if (!app.isReady()) throw new Error('App not ready')
  return applyCookies(sess, await readChromiumCookies(browser, profileDir))
}
