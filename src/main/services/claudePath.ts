/**
 * Claude Code CLI path resolution — single source of truth.
 *
 * ⚠️  DO NOT import from 'electron' here. This module must stay free of
 * Electron dependencies so it remains usable in UtilityProcess workers.
 *
 * Priority:
 *   1. System `claude` binary — common install locations + `which claude`
 *   2. Bundled cli.js in app.asar.unpacked
 *   3. __dirname relative fallback (dev only)
 */

import os from 'os'
import path from 'path'
import { existsSync, readdirSync } from 'fs'

/** Discover `claude` binary under any NVM-managed Node version. */
function findNvmClaude(home: string): string | undefined {
  const nvmDir = path.join(home, '.nvm/versions/node')
  try {
    const versions = readdirSync(nvmDir)
    // Sort descending so we prefer the newest Node version
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const v of versions) {
      const candidate = path.join(nvmDir, v, 'bin/claude')
      if (existsSync(candidate)) return candidate
    }
  } catch { /* .nvm doesn't exist — skip */ }
  return undefined
}

export function resolveCliPath(): string | undefined {
  const { execFileSync } = require('child_process') as typeof import('child_process')
  const home = os.homedir()

  // Strategy 1: system `claude` binary — most reliable, no asar issues
  const commonPaths = [
    path.join(home, '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ]
  for (const p of commonPaths) {
    if (existsSync(p)) return p
  }
  // Check NVM-managed Node versions (dynamic — no hardcoded versions)
  const nvmClaude = findNvmClaude(home)
  if (nvmClaude) return nvmClaude
  try {
    const enrichedPath = [
      path.join(home, '.local/bin'),
      '/opt/homebrew/bin', '/usr/local/bin',
      process.env.PATH ?? '',
    ].join(':')
    const result = execFileSync('which', ['claude'], {
      encoding: 'utf8', timeout: 3000,
      env: { ...process.env, PATH: enrichedPath },
    }).trim()
    if (result && existsSync(result)) return result
  } catch { /* claude not on PATH */ }

  // Strategy 2: bundled cli.js in app.asar.unpacked
  const SDK_REL = path.join('app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
  const resourcesViaExec = path.join(path.dirname(process.execPath), '..', 'Resources')
  const p2 = path.join(resourcesViaExec, SDK_REL)
  if (existsSync(p2)) return p2

  const rp = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (rp) {
    const p = path.join(rp, SDK_REL)
    if (existsSync(p)) return p
  }

  // Strategy 3: dev fallback
  const p3 = path.join(__dirname, '..', '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
  if (existsSync(p3)) return p3

  return undefined
}

/** Lazily-resolved auto CLI path (resolved once at module load time). */
export const AUTO_CLI_PATH: string | undefined = resolveCliPath()

/** Returns the best available cli.js path: user override → auto-resolved → undefined */
export function getCliPath(userPath?: string): string | undefined {
  if (userPath) {
    const expanded = userPath.startsWith('~')
      ? path.join(os.homedir(), userPath.slice(1))
      : userPath
    if (existsSync(expanded)) return expanded
  }
  return AUTO_CLI_PATH
}
