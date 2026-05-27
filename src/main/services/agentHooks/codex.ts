// ── Codex Hook Service ───────────────────────────────────────────────────────
// Config: ~/.codex/hooks.json plus trusted hook hashes in ~/.codex/config.toml

import { homedir } from 'os'
import { join } from 'path'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { generateHookScript, HOOK_SCRIPT_VERSION } from './hookScript'
import {
  addBraidHook,
  hasBraidHook,
  readHooksJson,
  removeBraidHooks,
  writeHooksJson,
  type HookConfig,
} from './jsonHooksConfig'
import {
  hasHookTrustEntries,
  removeHookTrustEntries,
  upsertHookTrustEntries,
  type CodexEventLabel,
  type CodexTrustEntry,
} from './codexTrust'

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
] as const

const CODEX_EVENT_LABEL: Record<(typeof EVENTS)[number], CodexEventLabel> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  PermissionRequest: 'permission_request',
  Stop: 'stop',
}

const HOOK_DIR = join(homedir(), '.braid', 'hooks')
const SCRIPT_NAME = 'agent-status-codex.sh'
const SCRIPT_PATH = join(HOOK_DIR, SCRIPT_NAME)
const HOOK_COMMAND = `~/.braid/hooks/${SCRIPT_NAME}`
const HOOKS_JSON_PATH = join(homedir(), '.codex', 'hooks.json')
const CONFIG_TOML_PATH = join(homedir(), '.codex', 'config.toml')

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

function isBraidCodexHook(command: string | undefined): command is string {
  return typeof command === 'string' && command.includes('.braid/hooks/') && command.includes(SCRIPT_NAME)
}

function findBraidHook(configs: HookConfig[]): {
  groupIndex: number
  handlerIndex: number
  command: string
} | null {
  let found: { groupIndex: number; handlerIndex: number; command: string } | null = null
  configs.forEach((config, groupIndex) => {
    if (!Array.isArray(config.hooks)) return
    config.hooks.forEach((hook, handlerIndex) => {
      if (isBraidCodexHook(hook.command)) {
        found = { groupIndex, handlerIndex, command: hook.command }
      }
    })
  })
  return found
}

function collectTrustEntries(hooksMap: Record<string, HookConfig[]>): CodexTrustEntry[] {
  const entries: CodexTrustEntry[] = []
  for (const event of EVENTS) {
    const found = findBraidHook(hooksMap[event] ?? [])
    if (!found) continue
    entries.push({
      sourcePath: HOOKS_JSON_PATH,
      eventLabel: CODEX_EVENT_LABEL[event],
      groupIndex: found.groupIndex,
      handlerIndex: found.handlerIndex,
      command: found.command,
    })
  }
  return entries
}

export function ensureHooks(): void {
  const installedVersion = readInstalledVersion()
  if (installedVersion < HOOK_SCRIPT_VERSION) {
    mkdirSync(HOOK_DIR, { recursive: true })
    const script = generateHookScript({ agentId: 'codex' })
    writeFileSync(SCRIPT_PATH, script, 'utf-8')
    chmodSync(SCRIPT_PATH, 0o755)
  }

  const hooksMap = readHooksJson(HOOKS_JSON_PATH)
  let changed = false

  for (const event of EVENTS) {
    const configs = hooksMap[event] ?? []
    if (!hasBraidHook(configs, SCRIPT_NAME)) {
      hooksMap[event] = addBraidHook(configs, HOOK_COMMAND)
      changed = true
    }
  }

  if (changed) writeHooksJson(HOOKS_JSON_PATH, hooksMap)

  const trustEntries = collectTrustEntries(hooksMap)
  upsertHookTrustEntries(CONFIG_TOML_PATH, trustEntries)
}

export function removeHooks(): void {
  const hooksMap = readHooksJson(HOOKS_JSON_PATH)
  const trustEntries = collectTrustEntries(hooksMap)
  let changed = false

  for (const event of Object.keys(hooksMap)) {
    const cleaned = removeBraidHooks(hooksMap[event], SCRIPT_NAME)
    if (cleaned.length !== hooksMap[event].length) {
      hooksMap[event] = cleaned
      changed = true
    }
    if (hooksMap[event].length === 0) {
      delete hooksMap[event]
      changed = true
    }
  }

  if (changed) writeHooksJson(HOOKS_JSON_PATH, hooksMap)
  removeHookTrustEntries(CONFIG_TOML_PATH, trustEntries)
}

export function areHooksInstalled(): boolean {
  try {
    const hooksMap = readHooksJson(HOOKS_JSON_PATH)
    if (!EVENTS.every((event) => hasBraidHook(hooksMap[event] ?? [], SCRIPT_NAME))) {
      return false
    }
    const trustEntries = collectTrustEntries(hooksMap)
    return trustEntries.length === EVENTS.length && hasHookTrustEntries(CONFIG_TOML_PATH, trustEntries)
  } catch {
    return false
  }
}
