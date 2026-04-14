import type { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ─── PATH enrichment ──────────────────────────────────────────────────────────

export function buildEnrichedPath(): string {
  const home = homedir()
  const extras = [
    join(home, 'Braid', 'lsp-servers'), // downloaded binaries
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    `${home}/.cargo/bin`,
    `${home}/go/bin`,
    `${home}/.local/bin`,
    `${home}/.npm/bin`,
    `${home}/.yarn/bin`,
    '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin',
    '/usr/bin',
    '/bin',
  ]
  const systemPath = process.env.PATH ?? ''
  const combined = [...extras, ...systemPath.split(':').filter(Boolean)]
  // deduplicate while preserving order
  return [...new Set(combined)].join(':')
}

export function findBinary(command: string, enrichedPath: string): string | null {
  for (const dir of enrichedPath.split(':')) {
    const candidate = join(dir, command)
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // skip
    }
  }
  return null
}

// ─── JSON-RPC transport ───────────────────────────────────────────────────────

export function pathToFileUri(p: string): string {
  // Encode all chars that are invalid in the path portion of a file URI.
  // A naive space-only replace breaks on paths containing #, ?, %, etc.
  return 'file://' + p.split('/').map((seg) => encodeURIComponent(seg)).join('/')
}

export function fileUriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''))
}

export function writeMessage(process: ChildProcess, message: object): void {
  const body = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`
  process.stdin?.write(header)
  process.stdin?.write(body)
}

export function parseSeverity(s: number): 1 | 2 | 4 | 8 {
  // LSP: Error=1, Warning=2, Info=3, Hint=4
  // Monaco: Hint=1, Info=2, Warning=4, Error=8
  switch (s) {
    case 1: return 8  // Error
    case 2: return 4  // Warning
    case 3: return 2  // Info
    case 4: return 1  // Hint
    default: return 4
  }
}
