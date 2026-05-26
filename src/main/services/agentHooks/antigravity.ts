// ── Antigravity Hook Service ─────────────────────────────────────────────────
// Config: ~/.gemini/config/hooks.json (separate from Gemini CLI's settings.json)
// Note: Antigravity requires valid JSON response on stdout (emitStdout: true)

import { homedir } from 'os'
import { join } from 'path'
import { createAgentHookService } from './createService'

const EVENTS = [
  'PreInvocation',
  'PostInvocation',
  'PostToolUse',
  'Stop',
] as const

export const { ensureHooks, removeHooks, areHooksInstalled } = createAgentHookService({
  agentId: 'antigravity',
  configPath: join(homedir(), '.gemini', 'config', 'hooks.json'),
  events: EVENTS,
  scriptOptions: { emitStdout: true },
})
