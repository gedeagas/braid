// ── Grok Hook Service ────────────────────────────────────────────────────────
// Config: ~/.grok/hooks/orca-status.json (dedicated file in hooks dir)

import { homedir } from 'os'
import { join } from 'path'
import { createAgentHookService } from './createService'

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'Stop',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
] as const

export const { ensureHooks, removeHooks, areHooksInstalled } = createAgentHookService({
  agentId: 'grok',
  configPath: join(homedir(), '.grok', 'hooks', 'orca-status.json'),
  events: EVENTS,
})
