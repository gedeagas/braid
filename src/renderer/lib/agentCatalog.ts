/**
 * Catalog of CLI coding agents that can run in a big terminal tab.
 * Each entry defines how to detect and launch the agent binary.
 */

export interface AgentCatalogEntry {
  id: string
  label: string
  /** Binary to check on PATH via shell:checkTool */
  detectCmd: string
  /** Command written to PTY when launching */
  launchCmd: string
}

export const AGENT_CATALOG: AgentCatalogEntry[] = [
  { id: 'claude', label: 'Claude Code', detectCmd: 'claude', launchCmd: 'claude' },
  { id: 'codex', label: 'Codex', detectCmd: 'codex', launchCmd: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', detectCmd: 'gemini', launchCmd: 'gemini' },
  { id: 'copilot', label: 'GitHub Copilot', detectCmd: 'copilot', launchCmd: 'copilot' },
  { id: 'grok', label: 'Grok', detectCmd: 'grok', launchCmd: 'grok' },
  { id: 'aider', label: 'Aider', detectCmd: 'aider', launchCmd: 'aider' },
  { id: 'goose', label: 'Goose', detectCmd: 'goose', launchCmd: 'goose' },
  { id: 'amp', label: 'Amp', detectCmd: 'amp', launchCmd: 'amp' },
  { id: 'opencode', label: 'OpenCode', detectCmd: 'opencode', launchCmd: 'opencode' },
  { id: 'cursor', label: 'Cursor Agent', detectCmd: 'cursor-agent', launchCmd: 'cursor-agent' },
  { id: 'kiro', label: 'Kiro', detectCmd: 'kiro-cli', launchCmd: 'kiro-cli' },
  { id: 'antigravity', label: 'Antigravity', detectCmd: 'agy', launchCmd: 'agy' },
  { id: 'pi', label: 'Pi', detectCmd: 'pi', launchCmd: 'pi' },
  { id: 'omp', label: 'OMP', detectCmd: 'omp', launchCmd: 'omp' },
  { id: 'autohand', label: 'Autohand', detectCmd: 'autohand', launchCmd: 'autohand' },
  { id: 'kilo', label: 'Kilocode', detectCmd: 'kilo', launchCmd: 'kilo' },
  { id: 'crush', label: 'Crush', detectCmd: 'crush', launchCmd: 'crush' },
  { id: 'aug', label: 'Augment', detectCmd: 'auggie', launchCmd: 'auggie' },
  { id: 'cline', label: 'Cline', detectCmd: 'cline', launchCmd: 'cline' },
  { id: 'codebuff', label: 'Codebuff', detectCmd: 'codebuff', launchCmd: 'codebuff' },
  { id: 'command-code', label: 'Command Code', detectCmd: 'command-code', launchCmd: 'command-code' },
  { id: 'continue', label: 'Continue', detectCmd: 'continue', launchCmd: 'continue' },
  { id: 'droid', label: 'Droid', detectCmd: 'droid', launchCmd: 'droid' },
  { id: 'kimi', label: 'Kimi', detectCmd: 'kimi', launchCmd: 'kimi' },
  { id: 'mistral-vibe', label: 'Mistral Vibe', detectCmd: 'mistral-vibe', launchCmd: 'mistral-vibe' },
  { id: 'qwen-code', label: 'Qwen Code', detectCmd: 'qwen-code', launchCmd: 'qwen-code' },
  { id: 'rovo', label: 'Rovo Dev', detectCmd: 'rovo', launchCmd: 'rovo' },
  { id: 'hermes', label: 'Hermes', detectCmd: 'hermes', launchCmd: 'hermes --tui' },
  { id: 'openclaw', label: 'OpenClaw', detectCmd: 'openclaw', launchCmd: 'openclaw' },
]

/** Lookup a catalog entry by id. */
export function getAgentEntry(agentId: string): AgentCatalogEntry | undefined {
  return AGENT_CATALOG.find((a) => a.id === agentId)
}
