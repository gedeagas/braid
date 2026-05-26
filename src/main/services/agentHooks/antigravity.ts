// ── Antigravity Hook Service ─────────────────────────────────────────────────
//
// Config: ~/.gemini/config/hooks.json (separate from Gemini CLI's settings.json)
//
// Antigravity uses a bundle-based config format rather than the standard
// { hooks: { ... } } structure. Hooks live under a named bundle key:
//
//   { "braid-status": { "PreInvocation": [{ "type": "command", "command": "..." }], ... } }
//
// Two hook definition schemas:
//   - "direct": { "type": "command", "command": "ENV=val /bin/sh '/path'" }
//   - "tool":   { "matcher": "*", "hooks": [{ "type": "command", "command": "..." }] }
//
// Antigravity does NOT include hook_event_name in its stdin JSON, so the event
// name is passed via BRAID_HOOK_EVENT env var in the command string.

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { dirname } from 'path'
import { HOOK_SCRIPT_VERSION } from './hookScript'
import type { AgentHookService } from './types'

// ── Constants ────────────────────────────────────────────────────────────────

const HOOK_DIR = join(homedir(), '.braid', 'hooks')
const SCRIPT_NAME = 'agent-status-antigravity.sh'
const SCRIPT_PATH = join(HOOK_DIR, SCRIPT_NAME)
const CONFIG_PATH = join(homedir(), '.gemini', 'config', 'hooks.json')
const BUNDLE_NAME = 'braid-status'

interface EventSpec {
  eventName: string
  /** 'direct' = flat { type, command }, 'tool' = nested { matcher, hooks: [...] } */
  schema: 'direct' | 'tool'
}

const EVENTS: EventSpec[] = [
  { eventName: 'PreInvocation', schema: 'direct' },
  { eventName: 'PostInvocation', schema: 'direct' },
  { eventName: 'PostToolUse', schema: 'tool' },
  { eventName: 'Stop', schema: 'direct' },
]

// ── Hook Script ──────────────────────────────────────────────────────────────
// Antigravity needs a custom script because:
//   1. Event name comes from BRAID_HOOK_EVENT env var, not stdin JSON
//   2. Stop event must output {"decision":""} on stdout, not {}

function generateAntigravityHookScript(): string {
  return `#!/bin/sh
# Braid agent status hook (antigravity) - POSTs status to Braid's loopback HTTP server.
# Managed by Braid. Do not edit - changes will be overwritten on next launch.
# BRAID_HOOK_VERSION=${HOOK_SCRIPT_VERSION}

# Output required JSON response on stdout first.
# Stop requires {"decision":""}, all others accept {}.
case "$BRAID_HOOK_EVENT" in
  Stop)
    printf '{"decision":""}\\n'
    ;;
  *)
    printf "{}\\n"
    ;;
esac

# Resolve hook server port and token from config file.
HOOK_CONFIG=~/.braid/hooks/hook-server.json
if [ -f "$HOOK_CONFIG" ]; then
  cfg=$(cat "$HOOK_CONFIG" 2>/dev/null)
  BRAID_HOOK_PORT=$(echo "$cfg" | sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\\([0-9]*\\).*/\\1/p')
  BRAID_HOOK_TOKEN=$(echo "$cfg" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
fi

# Guard: only run inside Braid big terminals
[ -z "$BRAID_HOOK_PORT" ] || [ -z "$BRAID_HOOK_TOKEN" ] || [ -z "$BRAID_TERMINAL_ID" ] && exit 0

# Read stdin payload
payload=$(cat)
[ -z "$payload" ] && exit 0

# POST to Braid's loopback server using form encoding (safe for paths with special chars)
curl -sS -X POST "http://127.0.0.1:\${BRAID_HOOK_PORT}/hook/antigravity" \\
  -H "Content-Type: application/json" \\
  -H "X-Braid-Token: \${BRAID_HOOK_TOKEN}" \\
  -d "{\\"terminalId\\":\\"\${BRAID_TERMINAL_ID}\\",\\"event\\":\\"\${BRAID_HOOK_EVENT}\\"}" \\
  >/dev/null 2>&1 || true
exit 0
`
}

// ── Command Wrapping ─────────────────────────────────────────────────────────
// Each event registers a command that sets BRAID_HOOK_EVENT env var before
// invoking the script, so the script knows which event triggered it.

function wrapCommand(eventName: string): string {
  const quoted = SCRIPT_PATH.replaceAll("'", "'\\''")
  return `BRAID_HOOK_EVENT='${eventName}' /bin/sh '${quoted}'`
}

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
  const command = wrapCommand(spec.eventName)
  if (spec.schema === 'tool') {
    return { matcher: '*', hooks: [{ type: 'command', command }] }
  }
  // Direct schema: flat { type, command } at top level
  return { type: 'command', command }
}

// ── Service ──────────────────────────────────────────────────────────────────

export function ensureHooks(): void {
  // 1. Create or update the hook script
  const installedVersion = readInstalledVersion()
  if (installedVersion < HOOK_SCRIPT_VERSION) {
    mkdirSync(HOOK_DIR, { recursive: true })
    writeFileSync(SCRIPT_PATH, generateAntigravityHookScript(), 'utf-8')
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
