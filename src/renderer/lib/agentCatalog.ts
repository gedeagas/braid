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
  /** Maps to an icon component or fallback letter */
  iconKey: string
}

export const AGENT_CATALOG: AgentCatalogEntry[] = [
  { id: 'claude', label: 'Claude Code', detectCmd: 'claude', launchCmd: 'claude', iconKey: 'claude' },
  { id: 'codex', label: 'Codex', detectCmd: 'codex', launchCmd: 'codex', iconKey: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', detectCmd: 'gemini', launchCmd: 'gemini', iconKey: 'gemini' },
  { id: 'copilot', label: 'GitHub Copilot', detectCmd: 'copilot', launchCmd: 'copilot', iconKey: 'copilot' },
  { id: 'grok', label: 'Grok', detectCmd: 'grok', launchCmd: 'grok', iconKey: 'grok' },
  { id: 'aider', label: 'Aider', detectCmd: 'aider', launchCmd: 'aider', iconKey: 'aider' },
  { id: 'goose', label: 'Goose', detectCmd: 'goose', launchCmd: 'goose', iconKey: 'goose' },
  { id: 'amp', label: 'Amp', detectCmd: 'amp', launchCmd: 'amp', iconKey: 'amp' },
  { id: 'opencode', label: 'OpenCode', detectCmd: 'opencode', launchCmd: 'opencode', iconKey: 'opencode' },
  { id: 'cursor', label: 'Cursor Agent', detectCmd: 'cursor-agent', launchCmd: 'cursor-agent', iconKey: 'cursor' },
  { id: 'kiro', label: 'Kiro', detectCmd: 'kiro-cli', launchCmd: 'kiro-cli', iconKey: 'kiro' },
  { id: 'antigravity', label: 'Antigravity', detectCmd: 'agy', launchCmd: 'agy', iconKey: 'antigravity' },
  { id: 'pi', label: 'Pi', detectCmd: 'pi', launchCmd: 'pi', iconKey: 'pi' },
  { id: 'omp', label: 'OMP', detectCmd: 'omp', launchCmd: 'omp', iconKey: 'omp' },
  { id: 'autohand', label: 'Autohand', detectCmd: 'autohand', launchCmd: 'autohand', iconKey: 'autohand' },
  { id: 'kilo', label: 'Kilocode', detectCmd: 'kilo', launchCmd: 'kilo', iconKey: 'kilo' },
  { id: 'crush', label: 'Crush', detectCmd: 'crush', launchCmd: 'crush', iconKey: 'crush' },
  { id: 'aug', label: 'Augment', detectCmd: 'auggie', launchCmd: 'auggie', iconKey: 'aug' },
  { id: 'cline', label: 'Cline', detectCmd: 'cline', launchCmd: 'cline', iconKey: 'cline' },
  { id: 'codebuff', label: 'Codebuff', detectCmd: 'codebuff', launchCmd: 'codebuff', iconKey: 'codebuff' },
  { id: 'command-code', label: 'Command Code', detectCmd: 'command-code', launchCmd: 'command-code', iconKey: 'command-code' },
  { id: 'continue', label: 'Continue', detectCmd: 'continue', launchCmd: 'continue', iconKey: 'continue' },
  { id: 'droid', label: 'Droid', detectCmd: 'droid', launchCmd: 'droid', iconKey: 'droid' },
  { id: 'kimi', label: 'Kimi', detectCmd: 'kimi', launchCmd: 'kimi', iconKey: 'kimi' },
  { id: 'mistral-vibe', label: 'Mistral Vibe', detectCmd: 'mistral-vibe', launchCmd: 'mistral-vibe', iconKey: 'mistral-vibe' },
  { id: 'qwen-code', label: 'Qwen Code', detectCmd: 'qwen-code', launchCmd: 'qwen-code', iconKey: 'qwen-code' },
  { id: 'rovo', label: 'Rovo Dev', detectCmd: 'rovo', launchCmd: 'rovo', iconKey: 'rovo' },
  { id: 'hermes', label: 'Hermes', detectCmd: 'hermes', launchCmd: 'hermes --tui', iconKey: 'hermes' },
  { id: 'openclaw', label: 'OpenClaw', detectCmd: 'openclaw', launchCmd: 'openclaw', iconKey: 'openclaw' },
]

/** Lookup a catalog entry by id. */
export function getAgentEntry(agentId: string): AgentCatalogEntry | undefined {
  return AGENT_CATALOG.find((a) => a.id === agentId)
}
