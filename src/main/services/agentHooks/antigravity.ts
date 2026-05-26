// ── Antigravity Hook Service ─────────────────────────────────────────────────
//
// Config: ~/.gemini/config/hooks.json (separate from Gemini CLI's settings.json)
//
// Antigravity uses a bundle-based config format rather than the standard
// { hooks: { ... } } structure. Hooks live under a named bundle key:
//
//   { "braid-status": { "PreInvocation": [{ "type": "command", ... }], ... } }
//
// PostToolUse uses a "tool" schema with a matcher field, while other events
// use a "direct" schema.

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { dirname } from 'path'
import { generateHookScript, HOOK_SCRIPT_VERSION } from './hookScript'
import type { AgentHookService } from './types'

// ── Constants ────────────────────────────────────────────────────────────────

const HOOK_DIR = join(homedir(), '.braid', 'hooks')
const SCRIPT_NAME = 'agent-status-antigravity.sh'
const SCRIPT_PATH = join(HOOK_DIR, SCRIPT_NAME)
const HOOK_COMMAND = `~/.braid/hooks/${SCRIPT_NAME}`
const CONFIG_PATH = join(homedir(), '.gemini', 'config', 'hooks.json')
const BUNDLE_NAME = 'braid-status'

interface EventSpec {
  eventName: string
  /** 'direct' = top-level command, 'tool' = nested with matcher: '*' */
  schema: 'direct' | 'tool'
}

const EVENTS: EventSpec[] = [
  { eventName: 'PreInvocation', schema: 'direct' },
  { eventName: 'PostInvocation', schema: 'direct' },
  { eventName: 'PostToolUse', schema: 'tool' },
  { eventName: 'Stop', schema: 'direct' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

type HookDef = Record<string, unknown>
type BundleConfig = Record<string, unknown>
type ConfigJson = Record<string, unknown>

function readInstalledVersion(): number {
  try {
    if (!existsSync(SCRIPT_PATH)) return 0
    const content = readFileSync(SCRIPT_PATH, 'utf-8')
    const match = content.match(/BRAID_HOOK_VERSION=(\d+)/)
    return match ? parseInt(match[1], 10) : 0
  } catch {
    return 0
  }
}

function readConfig(): ConfigJson {
  try {
    if (!existsSync(CONFIG_PATH)) return {}
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeConfig(config: ConfigJson): void {
  const dir = dirname(CONFIG_PATH)
  mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

function getBundle(config: ConfigJson): BundleConfig {
  const existing = config[BUNDLE_NAME]
  return typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ? { ...existing as BundleConfig }
    : {}
}

function isBraidCommand(cmd: unknown): boolean {
  return typeof cmd === 'string' && cmd.includes('.braid/hooks/')
}

function hasBraidDef(defs: unknown[]): boolean {
  return defs.some((d) => {
    if (typeof d !== 'object' || d === null) return false
    const def = d as HookDef
    if (isBraidCommand(def.command)) return true
    if (Array.isArray(def.hooks)) {
      return (def.hooks as HookDef[]).some((h) => isBraidCommand(h.command))
    }
    return false
  })
}

function removeBraidDefs(defs: unknown[]): unknown[] {
  return defs.filter((d) => {
    if (typeof d !== 'object' || d === null) return true
    const def = d as HookDef
    if (isBraidCommand(def.command)) return false
    if (Array.isArray(def.hooks)) {
      return !(def.hooks as HookDef[]).some((h) => isBraidCommand(h.command))
    }
    return true
  })
}

function buildDefinition(spec: EventSpec): HookDef {
  if (spec.schema === 'tool') {
    return { matcher: '*', hooks: [{ type: 'command', command: HOOK_COMMAND }] }
  }
  return { hooks: [{ type: 'command', command: HOOK_COMMAND }] }
}

// ── Service ──────────────────────────────────────────────────────────────────

export function ensureHooks(): void {
  // 1. Create or update the hook script
  const installedVersion = readInstalledVersion()
  if (installedVersion < HOOK_SCRIPT_VERSION) {
    mkdirSync(HOOK_DIR, { recursive: true })
    const script = generateHookScript({ agentId: 'antigravity', emitStdout: true })
    writeFileSync(SCRIPT_PATH, script, 'utf-8')
    chmodSync(SCRIPT_PATH, 0o755)
  }

  // 2. Install hook references in the bundle
  const config = readConfig()
  const bundle = getBundle(config)
  let changed = false

  for (const spec of EVENTS) {
    const current = Array.isArray(bundle[spec.eventName]) ? bundle[spec.eventName] as unknown[] : []
    if (!hasBraidDef(current)) {
      const cleaned = removeBraidDefs(current)
      bundle[spec.eventName] = [...cleaned, buildDefinition(spec)]
      changed = true
    }
  }

  if (changed) {
    config[BUNDLE_NAME] = bundle
    writeConfig(config)
  }
}

export function removeHooks(): void {
  const config = readConfig()
  const bundle = getBundle(config)
  let changed = false

  for (const key of Object.keys(bundle)) {
    const defs = bundle[key]
    if (!Array.isArray(defs)) continue
    const cleaned = removeBraidDefs(defs)
    if (cleaned.length !== defs.length) {
      if (cleaned.length === 0) {
        delete bundle[key]
      } else {
        bundle[key] = cleaned
      }
      changed = true
    }
  }

  if (changed) {
    if (Object.keys(bundle).length === 0) {
      delete config[BUNDLE_NAME]
    } else {
      config[BUNDLE_NAME] = bundle
    }
    writeConfig(config)
  }
}

export function areHooksInstalled(): boolean {
  try {
    const config = readConfig()
    const bundle = getBundle(config)
    return EVENTS.every((spec) => {
      const defs = bundle[spec.eventName]
      return Array.isArray(defs) && hasBraidDef(defs)
    })
  } catch {
    return false
  }
}

export const antigravityHookService: AgentHookService = { ensureHooks, removeHooks, areHooksInstalled }
