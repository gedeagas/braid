import { homedir } from 'os'
import { join, resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs'
import {
  getMcpServersFromClaudeJson,
  setMcpServersToClaudeJson,
  getProjectMcpServersFromClaudeJson,
} from './claudeConfigMcp'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClaudePermissions {
  allow: string[]
  deny: string[]
}

export interface ClaudeHookEntry {
  type: 'command'
  command: string
}

export interface ClaudeHookConfig {
  hooks: ClaudeHookEntry[]
}

export interface ClaudePluginInfo {
  id: string
  name: string
  version: string
  scope: string
  enabled: boolean
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  scope: 'global' | 'project'
}

export interface SkillDetail {
  name: string
  description: string
  argumentHint: string
  disableModelInvocation: boolean
  allowedTools: string
  body: string
  additionalFiles: string[]
}

export type McpServerConfig =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }

type McpServerSource =
  | { kind: 'user'; file?: 'settings.json' | 'settings.local.json' | 'claude.json' }
  | { kind: 'project'; projectPath: string; file?: '.mcp.json' | 'settings.json' | 'settings.local.json' | 'claude.json' }
  | { kind: 'plugin'; pluginName: string }

export interface McpServerEntry {
  name: string
  enabled: boolean
  config: McpServerConfig
  source?: McpServerSource
}

interface ClaudeSettingsJson {
  permissions?: { allow?: string[]; deny?: string[] }
  hooks?: Record<string, ClaudeHookConfig[]>
  enabledPlugins?: Record<string, boolean>
  mcpServers?: Record<string, McpServerConfig>
  disabledMcpServers?: string[]
  [key: string]: unknown
}

interface InstalledPluginsJson {
  version: number
  plugins: Record<string, Array<{
    scope: string
    installPath: string
    version: string
    installedAt: string
    lastUpdated: string
    gitCommitSha: string
  }>>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function readText(path: string): string {
  try {
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

/** Parse SKILL.md YAML frontmatter (flat scalars only). */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  if (!raw.startsWith('---')) return { meta, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta, body: raw }
  const fmBlock = raw.slice(4, end) // skip first "---\n"
  for (const line of fmBlock.split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/)
    if (m) meta[m[1]] = m[2].trim()
  }
  const body = raw.slice(end + 4).replace(/^\n+/, '') // skip "\n---\n"
  return { meta, body }
}

/** Serialize frontmatter + body back to SKILL.md content. */
function serializeSkillMd(detail: SkillDetail): string {
  const lines = ['---']
  lines.push(`name: ${detail.name}`)
  if (detail.description) lines.push(`description: ${detail.description}`)
  if (detail.argumentHint) lines.push(`argument-hint: ${detail.argumentHint}`)
  if (detail.disableModelInvocation) lines.push(`disable-model-invocation: true`)
  if (detail.allowedTools) lines.push(`allowed-tools: ${detail.allowedTools}`)
  lines.push('---')
  lines.push('')
  lines.push(detail.body)
  return lines.join('\n')
}

/** List files recursively, returning paths relative to baseDir. */
function listFilesRecursive(dir: string, baseDir: string): string[] {
  if (!existsSync(dir)) return []
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full, baseDir))
    } else {
      results.push(full.slice(baseDir.length + 1)) // relative path
    }
  }
  return results
}

/** Read-modify-write: load existing JSON, patch a key, save back. */
function patchSettingsJson(configDir: string, key: string, value: unknown): void {
  const settingsPath = join(configDir, 'settings.json')
  const existing = readJson<ClaudeSettingsJson>(settingsPath, {})
  existing[key] = value
  mkdirSync(configDir, { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(existing, null, 2), 'utf-8')
}

// ── Service ──────────────────────────────────────────────────────────────────

const VALID_SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

class ClaudeConfigService {
  private configDir: string

  constructor() {
    this.configDir = join(homedir(), '.claude')
  }

  private settingsPath(): string {
    return join(this.configDir, 'settings.json')
  }

  private readSettings(): ClaudeSettingsJson {
    return readJson<ClaudeSettingsJson>(this.settingsPath(), {})
  }

  /** Ensure skillPath is strictly under a known skills directory. Throws on traversal. */
  private assertSkillPath(skillPath: string): void {
    const resolved = resolve(skillPath)
    const globalRoot = resolve(this.configDir, 'skills')
    if (resolved.startsWith(globalRoot + '/')) return
    // Project skills are nested under <project>/.claude/skills/ — accept any path matching the pattern
    if (/\/.claude\/skills\/[^/]+$/.test(resolved) && !resolved.includes('..')) return
    throw new Error(`Invalid skill path: ${skillPath}`)
  }

  /** Ensure projectPath looks like a real directory (no traversal into sensitive locations). */
  private assertProjectPath(projectPath: string): void {
    const resolved = resolve(projectPath)
    const home = homedir()
    // Block writes directly into home dotfiles (e.g. ~/.ssh, ~/.claude itself)
    if (resolved === home || resolved === this.configDir || resolved.startsWith(this.configDir + '/')) {
      throw new Error(`Invalid project path: ${projectPath}`)
    }
  }

  // ── Permissions ──────────────────────────────────────────────────────────

  getPermissions(): ClaudePermissions {
    const s = this.readSettings()
    return {
      allow: s.permissions?.allow ?? [],
      deny: s.permissions?.deny ?? [],
    }
  }

  setPermissions(perms: ClaudePermissions): void {
    patchSettingsJson(this.configDir, 'permissions', {
      allow: perms.allow,
      deny: perms.deny,
    })
  }

  getProjectPermissions(projectPath: string): ClaudePermissions {
    this.assertProjectPath(projectPath)
    const path = join(projectPath, '.claude', 'settings.local.json')
    const data = readJson<ClaudeSettingsJson>(path, {})
    return {
      allow: data.permissions?.allow ?? [],
      deny: data.permissions?.deny ?? [],
    }
  }

  setProjectPermissions(projectPath: string, perms: ClaudePermissions): void {
    this.assertProjectPath(projectPath)
    const dir = join(projectPath, '.claude')
    const path = join(dir, 'settings.local.json')
    const existing = readJson<ClaudeSettingsJson>(path, {})
    existing.permissions = { allow: perms.allow, deny: perms.deny }
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(existing, null, 2), 'utf-8')
  }

  // ── Hooks ────────────────────────────────────────────────────────────────

  getHooks(): Record<string, ClaudeHookConfig[]> {
    const s = this.readSettings()
    return s.hooks ?? {}
  }

  setHooks(hooks: Record<string, ClaudeHookConfig[]>): void {
    patchSettingsJson(this.configDir, 'hooks', hooks)
  }

  // ── Instructions (CLAUDE.md) ─────────────────────────────────────────────

  getGlobalInstructions(): string {
    return readText(join(this.configDir, 'CLAUDE.md'))
  }

  setGlobalInstructions(content: string): void {
    mkdirSync(this.configDir, { recursive: true })
    writeFileSync(join(this.configDir, 'CLAUDE.md'), content, 'utf-8')
  }

  getProjectInstructions(projectPath: string): string {
    this.assertProjectPath(projectPath)
    return readText(join(projectPath, 'CLAUDE.md'))
  }

  setProjectInstructions(projectPath: string, content: string): void {
    this.assertProjectPath(projectPath)
    writeFileSync(join(projectPath, 'CLAUDE.md'), content, 'utf-8')
  }

  // ── Plugins ──────────────────────────────────────────────────────────────

  getPlugins(): ClaudePluginInfo[] {
    const pluginsPath = join(this.configDir, 'plugins', 'installed_plugins.json')
    const data = readJson<InstalledPluginsJson>(pluginsPath, { version: 2, plugins: {} })
    const settings = this.readSettings()
    const enabledMap = settings.enabledPlugins ?? {}

    const result: ClaudePluginInfo[] = []
    for (const [id, installations] of Object.entries(data.plugins)) {
      const first = installations[0]
      if (!first) continue
      // Parse display name from id (e.g. "asdd-kit@asdd-kit" → "asdd-kit")
      const name = id.split('@')[0] || id
      result.push({
        id,
        name,
        version: first.version,
        scope: first.scope,
        enabled: enabledMap[id] !== false, // default to enabled
      })
    }
    return result
  }

  setPluginEnabled(pluginId: string, enabled: boolean): void {
    const settings = this.readSettings()
    const enabledPlugins = { ...settings.enabledPlugins, [pluginId]: enabled }
    patchSettingsJson(this.configDir, 'enabledPlugins', enabledPlugins)
  }

  // ── Skills ──────────────────────────────────────────────────────────────

  private scanSkillsDir(dir: string, scope: 'global' | 'project'): SkillInfo[] {
    if (!existsSync(dir)) return []
    const results: SkillInfo[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillDir = join(dir, entry.name)
      const skillMd = join(skillDir, 'SKILL.md')
      if (!existsSync(skillMd)) continue
      const { meta } = parseFrontmatter(readText(skillMd))
      results.push({
        name: meta.name || entry.name,
        description: meta.description || '',
        path: skillDir,
        scope,
      })
    }
    return results
  }

  getSkills(projectPath?: string): SkillInfo[] {
    const globalSkills = this.scanSkillsDir(join(this.configDir, 'skills'), 'global')
    if (!projectPath) return globalSkills
    const projectSkills = this.scanSkillsDir(join(projectPath, '.claude', 'skills'), 'project')
    return [...globalSkills, ...projectSkills]
  }

  getSkillDetail(skillPath: string): SkillDetail {
    this.assertSkillPath(skillPath)
    const raw = readText(join(skillPath, 'SKILL.md'))
    const { meta, body } = parseFrontmatter(raw)
    const allFiles = listFilesRecursive(skillPath, skillPath)
    const additionalFiles = allFiles.filter((f) => f !== 'SKILL.md')
    return {
      name: meta.name || '',
      description: meta.description || '',
      argumentHint: meta['argument-hint'] || '',
      disableModelInvocation: meta['disable-model-invocation'] === 'true',
      allowedTools: meta['allowed-tools'] || '',
      body,
      additionalFiles,
    }
  }

  setSkillDetail(skillPath: string, detail: SkillDetail): void {
    this.assertSkillPath(skillPath)
    const content = serializeSkillMd(detail)
    writeFileSync(join(skillPath, 'SKILL.md'), content, 'utf-8')
  }

  createSkill(scope: 'global' | 'project', name: string, description: string, projectPath?: string): SkillInfo {
    if (!VALID_SKILL_NAME.test(name)) {
      throw new Error(`Invalid skill name: ${name}`)
    }
    if (scope === 'project' && projectPath) {
      this.assertProjectPath(projectPath)
    }
    const baseDir = scope === 'global'
      ? join(this.configDir, 'skills')
      : join(projectPath!, '.claude', 'skills')
    const skillDir = join(baseDir, name)
    mkdirSync(skillDir, { recursive: true })
    const detail: SkillDetail = {
      name, description, argumentHint: '', disableModelInvocation: false,
      allowedTools: '', body: '', additionalFiles: [],
    }
    writeFileSync(join(skillDir, 'SKILL.md'), serializeSkillMd(detail), 'utf-8')
    return { name, description, path: skillDir, scope }
  }

  deleteSkill(skillPath: string): void {
    this.assertSkillPath(skillPath)
    if (existsSync(skillPath) && statSync(skillPath).isDirectory()) {
      rmSync(skillPath, { recursive: true })
    }
  }

  // ── MCP Servers ──────────────────────────────────────────────────────────

  /** Read user-level MCP servers with precedence:
   *  1. settings.local.json (highest — local overrides)
   *  2. ~/.claude.json (primary — where Claude CLI stores them)
   *  3. settings.json (legacy fallback)
   */
  getMcpServers(): McpServerEntry[] {
    const entries: McpServerEntry[] = []
    const seen = new Set<string>()

    // 1. settings.local.json (highest precedence)
    const localPath = join(this.configDir, 'settings.local.json')
    const local = readJson<ClaudeSettingsJson>(localPath, {})
    const localDisabled = new Set(local.disabledMcpServers ?? [])
    for (const [name, config] of Object.entries(local.mcpServers ?? {})) {
      seen.add(name)
      entries.push({ name, enabled: !localDisabled.has(name), config, source: { kind: 'user', file: 'settings.local.json' } })
    }

    // 2. ~/.claude.json (primary)
    for (const entry of getMcpServersFromClaudeJson()) {
      if (seen.has(entry.name)) continue
      seen.add(entry.name)
      entries.push(entry)
    }

    // 3. settings.json (legacy fallback)
    const s = this.readSettings()
    const disabled = new Set(s.disabledMcpServers ?? [])
    for (const [name, config] of Object.entries(s.mcpServers ?? {})) {
      if (seen.has(name)) continue
      entries.push({ name, enabled: !disabled.has(name), config, source: { kind: 'user', file: 'settings.json' } })
    }

    return entries
  }

  setMcpServers(servers: McpServerEntry[]): void {
    // Write to ~/.claude.json (primary — matches Claude CLI)
    setMcpServersToClaudeJson(servers)

    // Clean up legacy: remove mcpServers/disabledMcpServers from settings.json if present
    const settings = this.readSettings()
    if (settings.mcpServers || settings.disabledMcpServers) {
      delete settings.mcpServers
      delete settings.disabledMcpServers
      mkdirSync(this.configDir, { recursive: true })
      writeFileSync(this.settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
    }
  }

  /** Read MCP servers from all project-level sources with precedence:
   *  1. .claude/settings.local.json (highest)
   *  2. .claude/settings.json
   *  3. ~/.claude.json projects section
   *  4. .mcp.json (lowest)
   */
  getProjectMcpServers(projectPath: string): McpServerEntry[] {
    this.assertProjectPath(projectPath)
    const results: McpServerEntry[] = []
    const seen = new Set<string>()

    // Highest precedence: .claude/settings.local.json
    const localData = readJson<ClaudeSettingsJson>(join(projectPath, '.claude', 'settings.local.json'), {})
    const localDisabled = new Set(localData.disabledMcpServers ?? [])
    for (const [name, config] of Object.entries(localData.mcpServers ?? {})) {
      seen.add(name)
      results.push({ name, enabled: !localDisabled.has(name), config, source: { kind: 'project', projectPath, file: 'settings.local.json' } })
    }

    // Medium precedence: .claude/settings.json
    const sharedData = readJson<ClaudeSettingsJson>(join(projectPath, '.claude', 'settings.json'), {})
    const sharedDisabled = new Set(sharedData.disabledMcpServers ?? [])
    for (const [name, config] of Object.entries(sharedData.mcpServers ?? {})) {
      if (seen.has(name)) continue
      seen.add(name)
      results.push({ name, enabled: !sharedDisabled.has(name), config, source: { kind: 'project', projectPath, file: 'settings.json' } })
    }

    // ~/.claude.json projects section (user-level project overrides)
    for (const entry of getProjectMcpServersFromClaudeJson(projectPath)) {
      if (seen.has(entry.name)) continue
      seen.add(entry.name)
      results.push(entry)
    }

    // Lowest precedence: .mcp.json
    const mcpData = readJson<{ mcpServers?: Record<string, McpServerConfig> }>(join(projectPath, '.mcp.json'), {})
    for (const [name, config] of Object.entries(mcpData.mcpServers ?? {})) {
      if (seen.has(name)) continue
      results.push({ name, enabled: true, config, source: { kind: 'project', projectPath, file: '.mcp.json' } })
    }

    return results
  }

  /** Read MCP servers provided by installed plugins (from each plugin's `.mcp.json`). */
  getPluginMcpServers(): McpServerEntry[] {
    const pluginsPath = join(this.configDir, 'plugins', 'installed_plugins.json')
    const data = readJson<InstalledPluginsJson>(pluginsPath, { version: 2, plugins: {} })
    const result: McpServerEntry[] = []

    for (const [id, installations] of Object.entries(data.plugins)) {
      const first = installations[0]
      if (!first?.installPath) continue
      const mcpPath = join(first.installPath, '.mcp.json')
      const raw = readJson<Record<string, unknown>>(mcpPath, {})
      if (!raw || Object.keys(raw).length === 0) continue

      const pluginName = id.split('@')[0] || id

      // Support nested { mcpServers: { ... } } and flat { "name": { type, ... } } formats
      let serverMap: Record<string, McpServerConfig>
      if ('mcpServers' in raw && typeof raw.mcpServers === 'object' && raw.mcpServers !== null) {
        serverMap = raw.mcpServers as Record<string, McpServerConfig>
      } else {
        serverMap = {} as Record<string, McpServerConfig>
        for (const [key, val] of Object.entries(raw)) {
          if (val && typeof val === 'object' && ('type' in val || 'command' in val)) {
            serverMap[key] = val as McpServerConfig
          }
        }
      }

      for (const [name, config] of Object.entries(serverMap)) {
        result.push({
          name,
          enabled: true,
          config,
          source: { kind: 'plugin' as const, pluginName },
        })
      }
    }
    return result
  }
}

export const claudeConfigService = new ClaudeConfigService()
