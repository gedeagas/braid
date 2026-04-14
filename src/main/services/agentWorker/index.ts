export { AgentWorker } from './core'

// Re-export for backward compat (tests may import these directly from agentWorker)
export { globMatch, ruleMatch, matchesRuleList, matchesDenyList } from '../agentPermissions'

// Re-export pure functions for external consumers (tests, agentGenerate)
export { buildUserContent, cleanCommitMessage, cleanSessionTitle, loadPlugins } from '../agentUtils'
