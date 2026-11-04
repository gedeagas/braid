import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cliInstallDirectories, findCommands } from '../cliCommandDetection'

let home: string

function exe(dir: string, name: string, mode = 0o755): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), '#!/bin/sh\n')
  chmodSync(join(dir, name), mode)
}

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'braid-cli-')) })
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('findCommands', () => {
  it('finds commands on PATH first', () => {
    exe(join(home, 'a'), 'claude')
    exe(join(home, '.local', 'bin'), 'claude')
    const found = findCommands(['claude'], { pathEnv: join(home, 'a'), home, platform: 'linux' })
    expect(found.get('claude')).toBe(join(home, 'a', 'claude'))
  })

  it('falls back to install folders a GUI app misses on PATH', () => {
    exe(join(home, '.bun', 'bin'), 'droid')
    exe(join(home, '.nvm', 'versions', 'node', 'v22.1.0', 'bin'), 'gemini')
    exe(join(home, '.grok', 'bin'), 'grok')
    const found = findCommands(['droid', 'gemini', 'grok', 'kiro-cli'], { pathEnv: '', home, platform: 'linux' })
    expect([...found.keys()].sort()).toEqual(['droid', 'gemini', 'grok'])
  })

  it('ignores non-executable files and unsafe names', () => {
    exe(join(home, 'bin'), 'cn', 0o644)
    const found = findCommands(['cn', '../etc/passwd'], { pathEnv: join(home, 'bin'), home, platform: 'linux' })
    expect(found.size).toBe(0)
  })
})

describe('cliInstallDirectories', () => {
  it('lists platform-specific folders', () => {
    expect(cliInstallDirectories('darwin', '/h')).toContain('/opt/homebrew/bin')
    expect(cliInstallDirectories('linux', '/h')).toContain('/snap/bin')
    expect(cliInstallDirectories('linux', '/h')).not.toContain('/opt/homebrew/bin')
    expect(cliInstallDirectories('win32', '/h')).toEqual([])
  })
})
