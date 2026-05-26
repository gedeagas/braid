// ── Cursor Hook Service ──────────────────────────────────────────────────────
// Config: ~/.cursor/hooks.json
// Note: Cursor uses camelCase event names

import { homedir } from 'os'
import { join } from 'path'
import { createAgentHookService } from './createService'

const EVENTS = [
  'beforeSubmitPrompt',
  'stop',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'beforeShellExecution',
  'beforeMCPExecution',
  'afterAgentResponse',
] as const

export const { ensureHooks, removeHooks, areHooksInstalled } = createAgentHookService({
  agentId: 'cursor',
  configPath: join(homedir(), '.cursor', 'hooks.json'),
  events: EVENTS,
})
