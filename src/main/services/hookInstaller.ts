// ── Braid Agent Status Hook Installer ────────────────────────────────────────
//
// Creates a hook script at ~/.braid/hooks/agent-status.sh and installs
// references into ~/.claude/settings.json. When Claude Code runs inside
// a Braid big terminal, hooks fire HTTP callbacks to the loopback server
// in Braid's main process.
//
// The hook script guards on BRAID_HOOK_PORT env var, so it's a no-op when
// Claude Code runs outside Braid's big terminals.

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { claudeConfigService } from './claudeConfig'
import type { ClaudeHookConfig } from './claudeConfig'

// ── Constants ────────────────────────────────────────────────────────────────

const HOOK_VERSION = 4
const HOOK_DIR = join(homedir(), '.braid', 'hooks')
const HOOK_PATH = join(HOOK_DIR, 'agent-status.sh')
const HOOK_COMMAND = '~/.braid/hooks/agent-status.sh'

/** Claude Code hook events we subscribe to. */
const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
] as const

// ── Hook Script Content ──────────────────────────────────────────────────────
//
// The script:
//   1. Guards on BRAID_HOOK_PORT (only set inside Braid big terminals)
//   2. Reads Claude Code's hook event JSON from stdin
//   3. Extracts event name and tool_name (best-effort bash regex, no jq dep)
//   4. POSTs a compact JSON payload to the loopback HTTP server
//   5. Runs curl in background so it doesn't block Claude's hook pipeline

const HOOK_SCRIPT = `#!/bin/bash
# Braid agent status hook - POSTs status to Braid's loopback HTTP server.
# Managed by Braid. Do not edit - changes will be overwritten on next launch.
# BRAID_HOOK_VERSION=${HOOK_VERSION}

# Resolve hook server port and token.
# Prefer the config file (survives Electron restart for daemon PTY sessions)
# over env vars (which become stale after restart).
HOOK_CONFIG=~/.braid/hooks/hook-server.json
if [ -f "$HOOK_CONFIG" ]; then
  cfg=$(cat "$HOOK_CONFIG" 2>/dev/null)
  [[ "$cfg" =~ \\"port\\"[[:space:]]*:[[:space:]]*([0-9]+) ]] && BRAID_HOOK_PORT="\${BASH_REMATCH[1]}"
  [[ "$cfg" =~ \\"token\\"[[:space:]]*:[[:space:]]*\\"([^\\"]+)\\" ]] && BRAID_HOOK_TOKEN="\${BASH_REMATCH[1]}"
fi

# Guard: only run inside Braid big terminals
[ -z "$BRAID_HOOK_PORT" ] && exit 0

# Read stdin (Claude Code sends hook event JSON payload)
input=$(cat)

# Extract hook_event_name from JSON (best-effort bash regex, no jq dependency)
event=""
[[ "$input" =~ \\"hook_event_name\\"[[:space:]]*:[[:space:]]*\\"([^\\"]+)\\" ]] && event="\${BASH_REMATCH[1]}"

# Extract tool_name if present
tool=""
[[ "$input" =~ \\"tool_name\\"[[:space:]]*:[[:space:]]*\\"([^\\"]+)\\" ]] && tool="\${BASH_REMATCH[1]}"

# Extract is_interrupt for Stop events
is_interrupt="false"
[[ "$input" =~ \\"is_interrupt\\"[[:space:]]*:[[:space:]]*true ]] && is_interrupt="true"

# Sanitize extracted values: strip any quotes/backslashes to prevent JSON injection
event="\${event//[\\\\\\"\\']/}"
tool="\${tool//[\\\\\\"\\']/}"

# Build JSON payload for Braid server
json="{\\"terminalId\\":\\"$BRAID_TERMINAL_ID\\",\\"event\\":\\"$event\\""
[ -n "$tool" ] && json="$json,\\"toolName\\":\\"$tool\\""
[ "$is_interrupt" = "true" ] && json="$json,\\"isInterrupt\\":true"
json="$json}"

# POST to Braid's loopback server (background, non-blocking)
curl -sS -o /dev/null \\
  -X POST "http://127.0.0.1:\${BRAID_HOOK_PORT}/hook/agent" \\
  -H "Content-Type: application/json" \\
  -H "X-Braid-Token: \${BRAID_HOOK_TOKEN}" \\
  -d "$json" \\
  2>/dev/null &
`

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read the BRAID_HOOK_VERSION from an existing script file. Returns 0 if missing or unparseable. */
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

/** Check if a hook config array contains a Braid entry. */
function hasBraidEntry(configs: ClaudeHookConfig[]): boolean {
  return configs.some((c) =>
    c.hooks.some((h) => h.command.includes('.braid/hooks/agent-status.sh'))
  )
}

/** Create a Braid hook config entry. */
function braidHookConfig(): ClaudeHookConfig {
  return { hooks: [{ type: 'command', command: HOOK_COMMAND }] }
}

/** Remove Braid entries from a hook config array, preserving user hooks. */
function removeBraidEntries(configs: ClaudeHookConfig[]): ClaudeHookConfig[] {
  return configs.filter(
    (c) => !c.hooks.some((h) => h.command.includes('.braid/hooks/agent-status.sh'))
  )
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure the Braid agent status hook script exists and is registered in
 * Claude Code's settings. Idempotent - safe to call on every app launch.
 */
export function ensureBraidHooks(): void {
  try {
    // 1. Create or update the hook script
    const installedVersion = readInstalledVersion()
    if (installedVersion < HOOK_VERSION) {
      mkdirSync(HOOK_DIR, { recursive: true })
      writeFileSync(HOOK_PATH, HOOK_SCRIPT, 'utf-8')
      chmodSync(HOOK_PATH, 0o755)
    }

    // 2. Install hook references in ~/.claude/settings.json
    const existing = claudeConfigService.getHooks()
    let changed = false

    for (const event of HOOK_EVENTS) {
      const configs = existing[event] ?? []
      if (!hasBraidEntry(configs)) {
        existing[event] = [...configs, braidHookConfig()]
        changed = true
      }
    }

    if (changed) {
      claudeConfigService.setHooks(existing)
    }
  } catch (err) {
    // Non-fatal: hooks are a best-effort enhancement.
    // Log but don't crash the app if settings.json is locked or permissions fail.
    console.warn('[hookInstaller] Failed to install Braid hooks:', err)
  }
}

/**
 * Remove all Braid hook entries from Claude Code's settings.
 * Preserves user-defined hooks for the same events.
 * Does NOT delete the script file (harmless orphan).
 */
export function removeBraidHooks(): void {
  try {
    const existing = claudeConfigService.getHooks()
    let changed = false

    for (const event of Object.keys(existing)) {
      const cleaned = removeBraidEntries(existing[event])
      if (cleaned.length !== existing[event].length) {
        existing[event] = cleaned
        changed = true
      }
      // Remove the event key entirely if no hooks remain
      if (existing[event].length === 0) {
        delete existing[event]
        changed = true
      }
    }

    if (changed) {
      claudeConfigService.setHooks(existing)
    }
  } catch (err) {
    console.warn('[hookInstaller] Failed to remove Braid hooks:', err)
  }
}

/** Check whether Braid hooks are currently installed in settings.json. */
export function areBraidHooksInstalled(): boolean {
  try {
    const hooks = claudeConfigService.getHooks()
    return HOOK_EVENTS.every((event) => {
      const configs = hooks[event] ?? []
      return hasBraidEntry(configs)
    })
  } catch {
    return false
  }
}
