/**
 * Read/write MCP server config from ~/.claude.json
 *
 * Claude CLI stores MCP servers in ~/.claude.json (top-level `mcpServers` for
 * user-level, `projects[path].mcpServers` for project-level). This module
 * handles format normalization and round-trip preservation of extra fields
 * (autoApprove, timeout, etc.) that Braid doesn't surface in the UI.
 */

import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { McpServerEntry, McpServerConfig } from './claudeConfig'

// ── Raw types for ~/.claude.json ────────────────────────────────────────────

interface ClaudeJsonRaw {
  mcpServers?: Record<string, RawMcpServerConfig>
  projects?: Record<string, ClaudeJsonProjectEntry>
  [key: string]: unknown
}

interface ClaudeJsonProjectEntry {
  mcpServers?: Record<string, RawMcpServerConfig>
  disabledMcpServers?: string[]
  [key: string]: unknown
}

/** Server config as stored in ~/.claude.json — may have legacy/extra fields. */
interface RawMcpServerConfig {
  type?: string
  transportType?: string // legacy alias for type
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
  autoApprove?: string[]
  timeout?: number
  [key: string]: unknown
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const CLAUDE_JSON_PATH = join(homedir(), '.claude.json')

/** Known keys that map to McpServerConfig — everything else is preserved as extras. */
const KNOWN_KEYS = new Set([
  'type', 'transportType', 'command', 'args', 'env',
  'url', 'headers', 'disabled',
])

function readClaudeJson(): ClaudeJsonRaw {
  try {
    if (!existsSync(CLAUDE_JSON_PATH)) return {}
    return JSON.parse(readFileSync(CLAUDE_JSON_PATH, 'utf-8')) as ClaudeJsonRaw
  } catch {
    return {}
  }
}

function writeClaudeJson(data: ClaudeJsonRaw): void {
  writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

function resolveType(raw: RawMcpServerConfig): 'stdio' | 'sse' | 'http' {
  const t = raw.type ?? raw.transportType
  if (t === 'sse') return 'sse'
  if (t === 'http') return 'http'
  if (t === 'stdio' || raw.command) return 'stdio'
  if (raw.url) return 'http'
  return 'stdio'
}

function normalizeConfig(raw: RawMcpServerConfig): McpServerConfig {
  const type = resolveType(raw)
  if (type === 'sse') {
    const cfg: McpServerConfig = { type: 'sse', url: raw.url ?? '' }
    if (raw.headers) cfg.headers = raw.headers
    return cfg
  }
  if (type === 'http') {
    const cfg: McpServerConfig = { type: 'http', url: raw.url ?? '' }
    if (raw.headers) cfg.headers = raw.headers
    return cfg
  }
  const cfg: McpServerConfig = { type: 'stdio', command: raw.command ?? '' }
  if (raw.args) cfg.args = raw.args
  if (raw.env) cfg.env = raw.env
  return cfg
}

/** Extract non-standard fields so they survive round-trip writes. */
function extractExtras(raw: RawMcpServerConfig): Record<string, unknown> {
  const extras: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(k)) extras[k] = v
  }
  return extras
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Read user-level MCP servers from ~/.claude.json top-level `mcpServers`. */
export function getMcpServersFromClaudeJson(): McpServerEntry[] {
  const data = readClaudeJson()
  const entries: McpServerEntry[] = []
  for (const [name, raw] of Object.entries(data.mcpServers ?? {})) {
    entries.push({
      name,
      enabled: raw.disabled !== true,
      config: normalizeConfig(raw),
      source: { kind: 'user', file: 'claude.json' },
    })
  }
  return entries
}

/** Write user-level MCP servers to ~/.claude.json, preserving all non-MCP data. */
export function setMcpServersToClaudeJson(servers: McpServerEntry[]): void {
  const data = readClaudeJson()
  const existingRaw = data.mcpServers ?? {}
  const newMap: Record<string, RawMcpServerConfig> = {}

  for (const server of servers) {
    // Preserve extras (autoApprove, timeout, etc.) from existing entry
    const extras = existingRaw[server.name] ? extractExtras(existingRaw[server.name]) : {}
    const cfg = server.config
    let raw: RawMcpServerConfig

    if (!cfg.type || cfg.type === 'stdio') {
      const stdio = cfg as { command: string; args?: string[]; env?: Record<string, string> }
      raw = { ...extras, type: 'stdio', command: stdio.command }
      if (stdio.args?.length) raw.args = stdio.args
      if (stdio.env && Object.keys(stdio.env).length) raw.env = stdio.env
    } else {
      const remote = cfg as { type: 'sse' | 'http'; url: string; headers?: Record<string, string> }
      raw = { ...extras, type: remote.type, url: remote.url }
      if (remote.headers && Object.keys(remote.headers).length) raw.headers = remote.headers
    }

    if (!server.enabled) raw.disabled = true
    else delete raw.disabled

    // Clean up legacy transportType if we're writing canonical type
    delete raw.transportType

    newMap[server.name] = raw
  }

  data.mcpServers = newMap
  writeClaudeJson(data)
}

/** Read project-level MCP servers from ~/.claude.json `projects[path].mcpServers`. */
export function getProjectMcpServersFromClaudeJson(projectPath: string): McpServerEntry[] {
  const data = readClaudeJson()
  const proj = data.projects?.[projectPath]
  if (!proj?.mcpServers) return []

  const disabledSet = new Set(proj.disabledMcpServers ?? [])
  const entries: McpServerEntry[] = []

  for (const [name, raw] of Object.entries(proj.mcpServers)) {
    entries.push({
      name,
      enabled: raw.disabled !== true && !disabledSet.has(name),
      config: normalizeConfig(raw),
      source: { kind: 'project', projectPath, file: 'claude.json' },
    })
  }
  return entries
}

// ── Test helpers (exported for unit tests only) ─────────────────────────────

export const _test = { resolveType, normalizeConfig, extractExtras, readClaudeJson }
