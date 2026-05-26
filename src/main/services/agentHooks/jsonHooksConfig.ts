// ── Generic JSON Hooks Config Reader/Writer ──────────────────────────────────
//
// Most agents (Claude, Gemini, Codex, Grok, Droid, Cursor, Copilot, Hermes)
// use an identical JSON hooks format:
//
//   { "hooks": { "EventName": [{ "hooks": [{ "type": "command", "command": "..." }] }] } }
//
// This module provides read/modify/write primitives for that format.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { logger } from '../../lib/logger'

// ── Types ────────────────────────────────────────────────────────────────────

export interface HookEntry {
  type: 'command'
  command: string
}

export interface HookConfig {
  hooks: HookEntry[]
}

/** The hooks section of an agent's settings JSON. */
export type HooksMap = Record<string, HookConfig[]>

interface SettingsJson {
  hooks?: HooksMap
  [key: string]: unknown
}

// ── Read / Write ─────────────────────────────────────────────────────────────

/** Read the hooks section from a JSON settings file. Returns empty map if missing. */
export function readHooksJson(configPath: string): HooksMap {
  try {
    if (!existsSync(configPath)) return {}
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as SettingsJson
    return raw.hooks ?? {}
  } catch {
    return {}
  }
}

/** Write hooks section back to the config file (read-modify-write). Creates file/dir if needed. */
export function writeHooksJson(configPath: string, hooks: HooksMap): void {
  let existing: SettingsJson = {}
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf-8')) as SettingsJson
    } catch (err) {
      logger.error(`[agentHooks] Failed to parse ${configPath}. Aborting write to prevent data loss.`, err)
      return
    }
  }
  existing.hooks = hooks
  const dir = dirname(configPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8')
}

// ── Braid Hook Detection / Manipulation ──────────────────────────────────────

const BRAID_HOOK_MARKER = '.braid/hooks/'

/** Check if a hook config array contains a Braid-managed entry. */
export function hasBraidHook(configs: HookConfig[], scriptFileName: string): boolean {
  return Array.isArray(configs) && configs.some((c) =>
    c && Array.isArray(c.hooks) && c.hooks.some((h) =>
      h && typeof h.command === 'string' && h.command.includes(BRAID_HOOK_MARKER) && h.command.includes(scriptFileName)
    )
  )
}

/** Add a Braid hook entry to a config array, preserving existing user hooks. */
export function addBraidHook(configs: HookConfig[], command: string): HookConfig[] {
  return [...(Array.isArray(configs) ? configs : []), { hooks: [{ type: 'command', command }] }]
}

/** Remove Braid entries from a hook config array, preserving user hooks. */
export function removeBraidHooks(configs: HookConfig[], scriptFileName: string): HookConfig[] {
  if (!Array.isArray(configs)) return []
  return configs.filter((c) =>
    !c || !Array.isArray(c.hooks) || !c.hooks.some((h) =>
      h && typeof h.command === 'string' && h.command.includes(BRAID_HOOK_MARKER) && h.command.includes(scriptFileName)
    )
  )
}
