// ── Gemini Hook Service ──────────────────────────────────────────────────────
// Config: ~/.gemini/settings.json
// Note: Gemini requires valid JSON response on stdout (emitStdout: true)

import { homedir } from 'os'
import { join } from 'path'
import { createAgentHookService } from './createService'

const EVENTS = ['BeforeAgent', 'AfterAgent', 'AfterTool', 'PreToolUse', 'PostToolUse'] as const

export const { ensureHooks, removeHooks, areHooksInstalled } = createAgentHookService({
  agentId: 'gemini',
  configPath: join(homedir(), '.gemini', 'settings.json'),
  events: EVENTS,
  scriptOptions: { emitStdout: true },
})
