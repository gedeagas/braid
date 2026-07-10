/**
 * Claude Code CLI path resolution — single source of truth.
 *
 * ⚠️  DO NOT import from 'electron' here. This module must stay free of
 * Electron dependencies so it remains usable in UtilityProcess workers.
 *
 * Priority:
 *   1. System `claude` binary — common install locations + `which claude`
 *   2. Bundled native SDK binary in app.asar.unpacked
 *   3. __dirname relative fallback (dev only)
 */

import os from 'os'
import path from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { enrichedEnv } from '../lib/enrichedEnv'

function sdkNativeBinaryRelativePaths(): string[] {
  const arch = process.arch
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const platform = process.platform === 'darwin'
    ? 'darwin'
    : process.platform === 'win32'
      ? 'win32'
      : 'linux'

  const names = [`claude-agent-sdk-${platform}-${arch}`]
  if (platform === 'linux') names.push(`claude-agent-sdk-linux-${arch}-musl`)
  return names.map((pkg) => path.join(pkg, `claude${suffix}`))
}

function findBundledSdkClaude(scopeDir: string): string | undefined {
  for (const rel of sdkNativeBinaryRelativePaths()) {
    const candidate = path.join(scopeDir, rel)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function findPackageRoot(resolvedPath: string, packageName: string): string | undefined {
  let dir = path.dirname(resolvedPath)
  while (true) {
    const manifest = path.join(dir, 'package.json')
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
        if (pkg.name === packageName) return dir
      } catch { /* keep walking */ }
    }

    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function findInstalledSdkClaude(): string | undefined {
  try {
    const sdkEntrypoint = require.resolve('@anthropic-ai/claude-agent-sdk')
    const sdkRoot = findPackageRoot(sdkEntrypoint, '@anthropic-ai/claude-agent-sdk')
    if (!sdkRoot) return undefined
    const scopeDir = path.dirname(sdkRoot)
    return findBundledSdkClaude(scopeDir)
  } catch {
    return undefined
  }
}

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
    const result = execFileSync('which', ['claude'], {
      encoding: 'utf8', timeout: 3000,
      env: enrichedEnv(),
    }).trim()
    if (result && existsSync(result)) return result
  } catch { /* claude not on PATH */ }

  // Strategy 2: bundled native SDK binary in app.asar.unpacked
  const SDK_SCOPE_REL = path.join('app.asar.unpacked', 'node_modules', '@anthropic-ai')
  const resourcesViaExec = path.join(path.dirname(process.execPath), '..', 'Resources')
  const p2 = findBundledSdkClaude(path.join(resourcesViaExec, SDK_SCOPE_REL))
  if (p2) return p2

  const rp = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (rp) {
    const p = findBundledSdkClaude(path.join(rp, SDK_SCOPE_REL))
    if (p) return p
  }

  // Strategy 3: dev fallback
  const p3 = findInstalledSdkClaude()
  if (p3) return p3

  return undefined
}

/** Lazily-resolved auto CLI path (resolved once at module load time). */
export const AUTO_CLI_PATH: string | undefined = resolveCliPath()

/** Returns the best available Claude Code executable path: user override → auto-resolved → undefined */
export function getCliPath(userPath?: string): string | undefined {
  if (userPath) {
    const expanded = userPath.startsWith('~')
      ? path.join(os.homedir(), userPath.slice(1))
      : userPath
    if (existsSync(expanded)) return expanded
  }
  return AUTO_CLI_PATH
}
