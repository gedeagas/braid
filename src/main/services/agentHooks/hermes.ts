// ── Hermes Hook Service ──────────────────────────────────────────────────────
// Config: ~/.hermes/hooks.json
// Note: Hermes uses snake_case event names

import { homedir } from 'os'
import { join } from 'path'
import { createAgentHookService } from './createService'

const EVENTS = [
  'on_session_start',
  'pre_llm_call',
  'post_llm_call',
  'pre_tool_call',
  'post_tool_call',
  'pre_approval_request',
  'post_approval_response',
  'on_session_end',
  'on_session_finalize',
  'on_session_reset',
] as const

export const { ensureHooks, removeHooks, areHooksInstalled } = createAgentHookService({
  agentId: 'hermes',
  configPath: join(homedir(), '.hermes', 'hooks.json'),
  events: EVENTS,
})
