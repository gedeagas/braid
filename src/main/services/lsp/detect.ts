import { existsSync, readdirSync } from 'fs'
import { join, extname, dirname } from 'path'
import { BUILTIN_SERVERS } from '../lsp-servers'
import { findBinary } from './helpers'
import type { LspServerConfig, LspDetectedServer, LspInstallCandidate } from './types'

// ─── Config resolution ───────────────────────────────────────────────────────

export function resolveConfigs(userConfigs: LspServerConfig[]): LspServerConfig[] {
  const merged = new Map<string, LspServerConfig>()
  for (const c of BUILTIN_SERVERS) merged.set(c.id, c)
  for (const c of userConfigs) merged.set(c.id, c)  // user overrides win
  return Array.from(merged.values())
}

// ─── Server detection ────────────────────────────────────────────────────────

export function detectServers(
  projectPath: string,
  userConfigs: LspServerConfig[],
  enrichedPath: string,
): LspDetectedServer[] {
  const configs = resolveConfigs(userConfigs)
  const detected: LspDetectedServer[] = []

  for (const config of configs) {
    // Check if any detect file exists in root or one subdirectory level
    const found = config.detectFiles.some(f => existsSync(join(projectPath, f))) ||
      (() => {
        try {
          return readdirSync(projectPath).some(entry => {
            const sub = join(projectPath, entry)
            return config.detectFiles.some(f => existsSync(join(sub, f)))
          })
        } catch { return false }
      })()

    if (!found) continue

    const installed = findBinary(config.command, enrichedPath) !== null
    const candidate = findInstallCandidate(config, enrichedPath)
    detected.push({ config, installed, installVia: candidate?.label })
  }

  return detected
}

/**
 * Core walk-up logic: finds the nearest ancestor of filePath (inclusive, up to
 * boundary) that contains one of config.detectFiles.
 * Accepts a resolved config object to avoid redundant resolveConfigs() calls.
 */
export function findNearestRootForConfig(
  filePath: string,
  config: LspServerConfig,
  boundary: string,
): string | null {
  const boundaryNorm = boundary.replace(/\/+$/, '')
  let dir = dirname(filePath)

  while (true) {
    for (const f of config.detectFiles) {
      if (existsSync(join(dir, f))) return dir
    }
    // Break after checking the boundary itself, or if dir escaped above it
    if (dir === boundaryNorm || !dir.startsWith(boundaryNorm + '/')) break
    const parent = dirname(dir)
    if (parent === dir) break   // filesystem root guard
    dir = parent
  }
  return null
}

/**
 * Like detectServers but file-aware: walks up from the opened file to find
 * the nearest module root for each matching language server.  This correctly
 * handles monorepos where go.mod / tsconfig.json etc. live in subdirectories
 * rather than at the repo root.
 *
 * Each returned entry includes `resolvedRoot` — use it (not the worktree root)
 * for all subsequent LSP operations on this file.
 */
export function detectServersForFile(
  filePath: string,
  boundary: string,
  userConfigs: LspServerConfig[],
  enrichedPath: string,
): LspDetectedServer[] {
  const configs = resolveConfigs(userConfigs)   // single resolveConfigs call
  const ext = extname(filePath).slice(1).toLowerCase()
  const result: LspDetectedServer[] = []

  for (const config of configs) {
    if (!config.extensions.includes(ext)) continue

    // Reuse already-resolved config — avoids O(N²) resolveConfigs calls
    const resolvedRoot = findNearestRootForConfig(filePath, config, boundary)
    if (!resolvedRoot) continue

    const installed = findBinary(config.command, enrichedPath) !== null
    const candidate = findInstallCandidate(config, enrichedPath)
    result.push({ config, installed, installVia: candidate?.label, resolvedRoot })
  }

  return result
}

export function findInstallCandidate(config: LspServerConfig, enrichedPath: string): LspInstallCandidate | null {
  const candidates = config.installCandidates ?? []

  // Prefer command-based installs (fastest, no network)
  for (const c of candidates) {
    if (c.type === 'command' && findBinary(c.prereq, enrichedPath)) return c
  }

  // Fall back to binary download — viable if URL exists for this platform
  const platformKey = `${process.platform}-${process.arch}`
  for (const c of candidates) {
    if (c.type === 'download' && (c.urls[platformKey] ?? c.urls['*'])) return c
  }

  return null
}
