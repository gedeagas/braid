// Big-terminal scrollback persistence (~/Braid/bigTerminals/<id>.scrollback),
// shared by the daemon adapter and the in-process PtyService. Written when a
// terminal exits, is killed, or the app quits, and replayed when its daemon
// session is gone.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

function scrollbackDir(): string {
  return join(homedir(), 'Braid', 'bigTerminals')
}

function scrollbackPath(terminalId: string): string {
  // Strict allowlist: terminalId must match our generated formats, big terminals
  // (bt-<digits>-<digits>) and right-panel tabs (rt-<digits>-<digits>).
  // Anything else is rejected to prevent path traversal.
  if (!/^[br]t-\d+-\d+$/.test(terminalId)) {
    throw new Error(`Invalid terminal id: ${terminalId}`)
  }
  return join(scrollbackDir(), `${terminalId}.scrollback`)
}

export function readScrollbackFile(terminalId: string): string {
  try {
    return readFileSync(scrollbackPath(terminalId), { encoding: 'utf8' })
  } catch {
    return ''
  }
}

export function writeScrollbackFile(terminalId: string, data: string, logTag = '[pty]'): void {
  try {
    mkdirSync(scrollbackDir(), { recursive: true })
    writeFileSync(scrollbackPath(terminalId), data, { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    // Non-fatal: scrollback is a best-effort restore aid
    console.warn(logTag, 'Failed to persist scrollback for', terminalId, err)
  }
}

export function deleteScrollbackFile(terminalId: string): void {
  try {
    unlinkSync(scrollbackPath(terminalId))
  } catch {
    // File may not exist
  }
}
