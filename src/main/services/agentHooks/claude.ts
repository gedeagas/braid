// ── Claude Code Hook Service ─────────────────────────────────────────────────
//
// Installs Braid status hooks into ~/.claude/settings.json.
// Refactored from the original hookInstaller.ts.

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { generateHookScript, HOOK_SCRIPT_VERSION } from './hookScript'
import { claudeConfigService } from '../claudeConfig'
import type { AgentHookService } from './types'

// ── Constants ────────────────────────────────────────────────────────────────

const HOOK_DIR = join(homedir(), '.braid', 'hooks')
const SCRIPT_NAME = 'agent-status.sh'
const HOOK_PATH = join(HOOK_DIR, SCRIPT_NAME)
const HOOK_COMMAND = `~/.braid/hooks/${SCRIPT_NAME}`

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
] as const

// ── Helpers ──────────────────────────────────────────────────────────────────

function readInstalledVersion(): number {
  try {
    if (!existsSync(HOOK_PATH)) return 0
    const content = readFileSync(HOOK_PATH, 'utf-8')
    const match = content.match(/BRAID_HOOK_VERSION=(\d+)/)
    return match ? parseInt(match[1], 10) : 0
  } catch {
    return 0
  }
}

function hasBraidEntry(configs: { hooks: { command: string }[] }[]): boolean {
  return Array.isArray(configs) && configs.some((c) =>
    c && Array.isArray(c.hooks) && c.hooks.some((h) =>
      h && typeof h.command === 'string' && h.command.includes(HOOK_COMMAND)
    )
  )
}

function removeBraidEntries<T extends { hooks: { command: string }[] }>(configs: T[]): T[] {
  if (!Array.isArray(configs)) return []
  return configs.filter((c) =>
    !c || !Array.isArray(c.hooks) || !c.hooks.some((h) =>
      h && typeof h.command === 'string' && h.command.includes(HOOK_COMMAND)
    )
  )
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Claude uses claudeConfigService for settings.json access (shared with
 * permissions, MCP servers, etc.), so we don't use the generic jsonHooksConfig
 * module here.
 */
export function ensureHooks(): void {
  // 1. Create or update the hook script
  const installedVersion = readInstalledVersion()
  if (installedVersion < HOOK_SCRIPT_VERSION) {
    mkdirSync(HOOK_DIR, { recursive: true })
    const script = generateHookScript({ agentId: 'claude' })
    writeFileSync(HOOK_PATH, script, 'utf-8')
    chmodSync(HOOK_PATH, 0o755)
  }

  // 2. Install hook references in ~/.claude/settings.json
  const existing = claudeConfigService.getHooks()
  let changed = false

  for (const event of EVENTS) {
    const configs = existing[event] ?? []
    if (!hasBraidEntry(configs)) {
      existing[event] = [...configs, { hooks: [{ type: 'command' as const, command: HOOK_COMMAND }] }]
      changed = true
    }
  }

  if (changed) {
    claudeConfigService.setHooks(existing)
  }
}

export function removeHooks(): void {
  const existing = claudeConfigService.getHooks()
  let changed = false

  for (const event of Object.keys(existing)) {
    const cleaned = removeBraidEntries(existing[event])
    if (cleaned.length !== existing[event].length) {
      existing[event] = cleaned
      changed = true
    }
    if (existing[event].length === 0) {
      delete existing[event]
      changed = true
    }
  }

  if (changed) {
    claudeConfigService.setHooks(existing)
  }
}

export function areHooksInstalled(): boolean {
  try {
    const hooks = claudeConfigService.getHooks()
    return EVENTS.every((event) => hasBraidEntry(hooks[event] ?? []))
  } catch {
    return false
  }
}

export const claudeHookService: AgentHookService = { ensureHooks, removeHooks, areHooksInstalled }
