// ── Codex Hook Service ───────────────────────────────────────────────────────
// Config: ~/.codex/hooks.json (JSON overlay - avoids TOML parsing)

import { homedir } from 'os'
import { join } from 'path'
import { createAgentHookService } from './createService'

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
] as const

export const { ensureHooks, removeHooks, areHooksInstalled } = createAgentHookService({
  agentId: 'codex',
  configPath: join(homedir(), '.codex', 'hooks.json'),
  events: EVENTS,
})
