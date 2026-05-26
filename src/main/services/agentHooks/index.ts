// ── Agent Hooks Orchestrator ─────────────────────────────────────────────────
//
// Barrel export + orchestrator that installs/removes hooks for all supported
// agents. Each service's ensureHooks() is called in a try/catch so one agent's
// failure doesn't block others.

import * as claude from './claude'
import * as gemini from './gemini'
import * as antigravity from './antigravity'
import * as codex from './codex'
import * as copilot from './copilot'
import * as cursor from './cursor'
import * as grok from './grok'
import * as droid from './droid'
import * as hermes from './hermes'
import type { AgentHookService } from './types'

export type { AgentHookTarget, AgentHookService } from './types'

const ALL_SERVICES: { name: string; service: AgentHookService }[] = [
  { name: 'claude', service: claude },
  { name: 'gemini', service: gemini },
  { name: 'antigravity', service: antigravity },
  { name: 'codex', service: codex },
  { name: 'copilot', service: copilot },
  { name: 'cursor', service: cursor },
  { name: 'grok', service: grok },
  { name: 'droid', service: droid },
  { name: 'hermes', service: hermes },
]

/**
 * Install hooks for all supported agents. Idempotent - safe to call on every
 * app launch. Failures for individual agents are logged but non-fatal.
 */
export function ensureAllAgentHooks(): void {
  for (const { name, service } of ALL_SERVICES) {
    try {
      service.ensureHooks()
    } catch (err) {
      console.warn(`[agentHooks] Failed to install hooks for ${name}:`, err)
    }
  }
}

/**
 * Remove Braid hooks from all supported agents. Preserves user-defined hooks.
 */
export function removeAllAgentHooks(): void {
  for (const { name, service } of ALL_SERVICES) {
    try {
      service.removeHooks()
    } catch (err) {
      console.warn(`[agentHooks] Failed to remove hooks for ${name}:`, err)
    }
  }
}
