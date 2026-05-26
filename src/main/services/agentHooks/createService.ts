// ── Generic Agent Hook Service Factory ───────────────────────────────────────
//
// Most non-Claude agents follow the same pattern: write a hook script, then
// register it in a JSON config file using the shared hooks format. This factory
// produces ensureHooks/removeHooks/areHooksInstalled for any such agent.

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { generateHookScript, HOOK_SCRIPT_VERSION, type HookScriptOptions } from './hookScript'
import {
  readHooksJson,
  writeHooksJson,
  hasBraidHook,
  addBraidHook,
  removeBraidHooks,
} from './jsonHooksConfig'
import type { AgentHookTarget, AgentHookService } from './types'

const HOOK_DIR = join(homedir(), '.braid', 'hooks')

export interface CreateServiceOptions {
  agentId: AgentHookTarget
  /** Absolute path to the agent's config file */
  configPath: string
  /** Hook event names this agent supports */
  events: readonly string[]
  /** Additional hook script options (e.g. emitStdout for Gemini) */
  scriptOptions?: Partial<HookScriptOptions>
}

function scriptFileName(agentId: string): string {
  return `agent-status-${agentId}.sh`
}

function readInstalledVersion(scriptPath: string): number {
  try {
    if (!existsSync(scriptPath)) return 0
    const content = readFileSync(scriptPath, 'utf-8')
    const match = content.match(/BRAID_HOOK_VERSION=(\d+)/)
    return match ? parseInt(match[1], 10) : 0
  } catch {
    return 0
  }
}

export function createAgentHookService(opts: CreateServiceOptions): AgentHookService {
  const { agentId, configPath, events, scriptOptions } = opts
  const fileName = scriptFileName(agentId)
  const scriptPath = join(HOOK_DIR, fileName)
  const hookCommand = `~/.braid/hooks/${fileName}`

  function ensureHooks(): void {
    // 1. Create or update the hook script
    const installedVersion = readInstalledVersion(scriptPath)
    if (installedVersion < HOOK_SCRIPT_VERSION) {
      mkdirSync(HOOK_DIR, { recursive: true })
      const script = generateHookScript({ agentId, ...scriptOptions })
      writeFileSync(scriptPath, script, 'utf-8')
      chmodSync(scriptPath, 0o755)
    }

    // 2. Install hook references in the agent's config
    const hooksMap = readHooksJson(configPath)
    let changed = false

    for (const event of events) {
      const configs = hooksMap[event] ?? []
      if (!hasBraidHook(configs, fileName)) {
        hooksMap[event] = addBraidHook(configs, hookCommand)
        changed = true
      }
    }

    if (changed) {
      writeHooksJson(configPath, hooksMap)
    }
  }

  function removeHooks(): void {
    const hooksMap = readHooksJson(configPath)
    let changed = false

    for (const event of Object.keys(hooksMap)) {
      const cleaned = removeBraidHooks(hooksMap[event], fileName)
      if (cleaned.length !== hooksMap[event].length) {
        hooksMap[event] = cleaned
        changed = true
      }
      if (hooksMap[event].length === 0) {
        delete hooksMap[event]
        changed = true
      }
    }

    if (changed) {
      writeHooksJson(configPath, hooksMap)
    }
  }

  function areHooksInstalled(): boolean {
    try {
      const hooksMap = readHooksJson(configPath)
      return events.every((event) => hasBraidHook(hooksMap[event] ?? [], fileName))
    } catch {
      return false
    }
  }

  return { ensureHooks, removeHooks, areHooksInstalled }
}
