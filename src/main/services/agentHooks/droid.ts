// ── Droid Hook Service ───────────────────────────────────────────────────────
// Config: ~/.factory/settings.json

import { homedir } from 'os'
import { join } from 'path'
import { createAgentHookService } from './createService'

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'Stop',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
] as const

export const { ensureHooks, removeHooks, areHooksInstalled } = createAgentHookService({
  agentId: 'droid',
  configPath: join(homedir(), '.factory', 'settings.json'),
  events: EVENTS,
})
