// ── Shared Types for Agent Hook Services ─────────────────────────────────────

/** Agents that support hook-based status detection. */
export type AgentHookTarget =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'antigravity'
  | 'copilot'
  | 'cursor'
  | 'grok'
  | 'droid'
  | 'hermes'

/** Configuration for a per-agent hook service. */
export interface AgentHookServiceConfig {
  /** Agent identifier, used for HTTP route /hook/<agentId> */
  agentId: AgentHookTarget
  /** Path to the managed hook script */
  scriptPath: string
  /** Command string registered in the agent's config */
  hookCommand: string
  /** Hook events this agent supports */
  events: readonly string[]
  /** Path to the agent's config file */
  configPath: string
}

/** Standard interface every per-agent hook service exports. */
export interface AgentHookService {
  ensureHooks(): void
  removeHooks(): void
  areHooksInstalled(): boolean
}
