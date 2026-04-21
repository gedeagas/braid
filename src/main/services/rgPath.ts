/**
 * Ripgrep binary path resolution — single source of truth.
 *
 * VSCode and Cursor bundle ripgrep inside the app so users never have to
 * install anything. We do the same, but we piggy-back on the ripgrep binaries
 * that the Claude Agent SDK already ships — so there's no extra download,
 * no extra dependency, and no extra disk usage.
 *
 * Priority:
 *   1. Bundled SDK rg in app.asar.unpacked (packaged app — the main case)
 *   2. Bundled SDK rg in dev node_modules (yarn dev)
 *   3. System `rg` on PATH (last-resort fallback; handled by caller)
 *
 * Supported platforms: macOS (arm64/x64), Linux (arm64/x64), Windows (arm64/x64).
 *
 * ⚠️  DO NOT import from 'electron' here. Keep this module Electron-free so
 * it's safe to import from UtilityProcess workers.
 */

import path from 'path'
import { existsSync } from 'fs'

const SUPPORTED_ARCHES = new Set(['arm64', 'x64'])
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32'])

/**
 * Build the platform-specific relative path to the rg binary inside the SDK
 * vendor directory. Returns `undefined` on unsupported platform/arch combos
 * (e.g. darwin-ia32 or linux-armv7).
 */
function vendorRelativePath(): string | undefined {
  const { platform, arch } = process
  if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHES.has(arch)) {
    return undefined
  }
  const binary = platform === 'win32' ? 'rg.exe' : 'rg'
  return path.join(
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'vendor',
    'ripgrep',
    `${arch}-${platform}`,
    binary,
  )
}

export function resolveRgPath(): string | undefined {
  const rel = vendorRelativePath()
  if (!rel) return undefined

  // Strategy 1: packaged app — Resources/app.asar.unpacked/...
  // (package.js already unpacks the whole claude-agent-sdk directory from asar)
  const unpackedRel = path.join('app.asar.unpacked', rel)
  const rp = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (rp) {
    const p = path.join(rp, unpackedRel)
    if (existsSync(p)) return p
  }
  // Fallback resources-dir calculation (matches claudePath pattern)
  const resourcesViaExec = path.join(path.dirname(process.execPath), '..', 'Resources')
  const p2 = path.join(resourcesViaExec, unpackedRel)
  if (existsSync(p2)) return p2

  // Strategy 2: dev mode — straight from node_modules
  const p3 = path.join(__dirname, '..', '..', rel)
  if (existsSync(p3)) return p3

  // Strategy 3: process.cwd() fallback (non-bundled tests / CI)
  const p4 = path.join(process.cwd(), rel)
  if (existsSync(p4)) return p4

  return undefined
}

/** Lazily-resolved bundled rg path (resolved once at module load time). */
export const BUNDLED_RG_PATH: string | undefined = resolveRgPath()
