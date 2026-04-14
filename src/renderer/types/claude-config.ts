// ─── Claude Agent Config ──────────────────────────────────────────────────────

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

export type ClaudeHookEvent = 'Stop' | 'Notification' | 'PreToolUse' | 'PostToolUse'

export interface ClaudePluginInfo {
  id: string
  name: string
  version: string
  scope: string
  enabled: boolean
}

export interface ClaudeSkillInfo {
  name: string
  description: string
  path: string
  scope: 'global' | 'project'
}

export interface ClaudeSkillDetail {
  name: string
  description: string
  argumentHint: string
  disableModelInvocation: boolean
  allowedTools: string
  body: string
  additionalFiles: string[]
}

// ─── MCP Servers ─────────────────────────────────────────────────────────────

export interface McpStdioConfig {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

export interface McpSseConfig {
  type: 'sse'
  url: string
  headers: Record<string, string>
}

export interface McpHttpConfig {
  type: 'http'
  url: string
  headers: Record<string, string>
}

export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig

export type McpServerSource =
  | { kind: 'user'; file?: 'settings.json' | 'settings.local.json' | 'claude.json' }
  | { kind: 'project'; projectPath: string; file?: '.mcp.json' | 'settings.json' | 'settings.local.json' | 'claude.json' }
  | { kind: 'plugin'; pluginName: string }

export interface McpServerEntry {
  name: string
  enabled: boolean
  config: McpServerConfig
  source?: McpServerSource
}

// ─── MCP Health Check ───────────────────────────────────────────────────────

export type McpHealthStatus = 'ok' | 'error' | 'auth_required' | 'unknown'

export interface McpHealthResult {
  name: string
  status: McpHealthStatus
  error?: string
}
