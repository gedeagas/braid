// ── Copilot Hook Service ─────────────────────────────────────────────────────
// Config: ~/.copilot/hooks/braid.json (dedicated file, not the main settings)
// Note: Copilot uses PascalCase event names in its hooks config

import { homedir } from 'os'
import { join } from 'path'
import { createAgentHookService } from './createService'

const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'subagentStart',
  'SubagentStop',
  'PreCompact',
  'Stop',
  'ErrorOccurred',
  'PermissionRequest',
  'Notification',
] as const

export const { ensureHooks, removeHooks, areHooksInstalled } = createAgentHookService({
  agentId: 'copilot',
  configPath: join(homedir(), '.copilot', 'hooks', 'braid.json'),
  events: EVENTS,
})
