export interface AgentCatalogEntry {
  id: string;
  label: string;
  detectCmd: string;
  launchCmd: string;
  faviconDomain?: string;
}

export const AGENT_CATALOG: AgentCatalogEntry[] = [
  { id: 'claude', label: 'Claude Code', detectCmd: 'claude', launchCmd: 'claude' },
  { id: 'codex', label: 'Codex', detectCmd: 'codex', launchCmd: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', detectCmd: 'gemini', launchCmd: 'gemini', faviconDomain: 'gemini.google.com' },
  { id: 'copilot', label: 'GitHub Copilot', detectCmd: 'copilot', launchCmd: 'copilot' },
  { id: 'grok', label: 'Grok', detectCmd: 'grok', launchCmd: 'grok', faviconDomain: 'x.ai' },
  { id: 'aider', label: 'Aider', detectCmd: 'aider', launchCmd: 'aider' },
  { id: 'goose', label: 'Goose', detectCmd: 'goose', launchCmd: 'goose', faviconDomain: 'block.github.io' },
  { id: 'amp', label: 'Amp', detectCmd: 'amp', launchCmd: 'amp', faviconDomain: 'ampcode.com' },
  { id: 'opencode', label: 'OpenCode', detectCmd: 'opencode', launchCmd: 'opencode', faviconDomain: 'opencode.ai' },
  { id: 'cursor', label: 'Cursor Agent', detectCmd: 'cursor-agent', launchCmd: 'cursor-agent', faviconDomain: 'cursor.com' },
  { id: 'kiro', label: 'Kiro', detectCmd: 'kiro-cli', launchCmd: 'kiro-cli', faviconDomain: 'kiro.dev' },
  { id: 'antigravity', label: 'Antigravity', detectCmd: 'agy', launchCmd: 'agy', faviconDomain: 'antigravity.google' },
  { id: 'pi', label: 'Pi', detectCmd: 'pi', launchCmd: 'pi' },
  { id: 'omp', label: 'OMP', detectCmd: 'omp', launchCmd: 'omp' },
  { id: 'autohand', label: 'Autohand', detectCmd: 'autohand', launchCmd: 'autohand', faviconDomain: 'autohand.ai' },
  { id: 'kilo', label: 'Kilocode', detectCmd: 'kilo', launchCmd: 'kilo' },
  { id: 'crush', label: 'Crush', detectCmd: 'crush', launchCmd: 'crush', faviconDomain: 'charm.sh' },
  { id: 'aug', label: 'Augment', detectCmd: 'auggie', launchCmd: 'auggie', faviconDomain: 'augmentcode.com' },
  { id: 'cline', label: 'Cline', detectCmd: 'cline', launchCmd: 'cline', faviconDomain: 'cline.bot' },
  { id: 'codebuff', label: 'Codebuff', detectCmd: 'codebuff', launchCmd: 'codebuff', faviconDomain: 'codebuff.com' },
  { id: 'command-code', label: 'Command Code', detectCmd: 'command-code', launchCmd: 'command-code', faviconDomain: 'commandcode.ai' },
  { id: 'continue', label: 'Continue', detectCmd: 'continue', launchCmd: 'continue', faviconDomain: 'continue.dev' },
  { id: 'droid', label: 'Droid', detectCmd: 'droid', launchCmd: 'droid' },
  { id: 'kimi', label: 'Kimi', detectCmd: 'kimi', launchCmd: 'kimi', faviconDomain: 'moonshot.cn' },
  { id: 'mistral-vibe', label: 'Mistral Vibe', detectCmd: 'mistral-vibe', launchCmd: 'mistral-vibe', faviconDomain: 'mistral.ai' },
  { id: 'qwen-code', label: 'Qwen Code', detectCmd: 'qwen-code', launchCmd: 'qwen-code', faviconDomain: 'qwenlm.github.io' },
  { id: 'rovo', label: 'Rovo Dev', detectCmd: 'rovo', launchCmd: 'rovo', faviconDomain: 'atlassian.com' },
  { id: 'hermes', label: 'Hermes', detectCmd: 'hermes', launchCmd: 'hermes --tui', faviconDomain: 'nousresearch.com' },
  { id: 'openclaw', label: 'OpenClaw', detectCmd: 'openclaw', launchCmd: 'openclaw', faviconDomain: 'openclaw.ai' },
];

// Sentinel id for a bare terminal: spawn the PTY with no agent launch command,
// leaving a plain shell prompt. Not part of AGENT_CATALOG (it isn't a detected
// CLI); the terminal screen renders it as its own picker row and gates it on the
// desktop's `terminal.bare.v1` capability. Mirrors SHELL_AGENT_ID on the desktop.
export const SHELL_AGENT_ID = 'shell';

export function getAgentEntry(agentId: string): AgentCatalogEntry | undefined {
  return AGENT_CATALOG.find((agent) => agent.id === agentId);
}
