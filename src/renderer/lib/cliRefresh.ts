import type { WorktreeRefreshReason, WorktreeResource } from './worktreeRefresh'

export interface CliRefreshPlan {
  resources: WorktreeResource[]
  reason: WorktreeRefreshReason
  force: boolean
  refreshWorktrees: boolean
  invalidateJiraCache: boolean
}

const SHELL_DELIMITERS = new Set([';', '&&', '||', '|', '(', ')'])
const SHELL_WRAPPERS = new Set(['sudo', 'env', 'time', 'command', 'builtin', 'nohup'])
const GIT_GLOBAL_FLAGS_WITH_VALUES = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
const GH_API_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const GH_PR_MUTATING_COMMANDS = new Set([
  'create',
  'edit',
  'close',
  'reopen',
  'merge',
  'ready',
  'lock',
  'unlock',
  'comment',
  'review',
])
const GH_RUN_MUTATING_COMMANDS = new Set(['rerun', 'cancel', 'delete'])
const GH_WORKFLOW_MUTATING_COMMANDS = new Set(['run', 'enable', 'disable'])
const ACLI_WORKITEM_MUTATING_COMMANDS = new Set([
  'create',
  'edit',
  'transition',
  'assign',
  'comment',
  'delete',
  'link',
  'move',
])

const GIT_FILE_RESOURCES: WorktreeResource[] = ['files', 'gitStatus', 'syncStatus', 'pr', 'checks', 'jira']
const GIT_REMOTE_RESOURCES: WorktreeResource[] = ['gitStatus', 'syncStatus', 'pr', 'checks']
const GIT_BRANCH_RESOURCES: WorktreeResource[] = ['files', 'gitStatus', 'syncStatus', 'pr', 'checks', 'jira', 'worktrees']
const PR_RESOURCES: WorktreeResource[] = ['pr', 'checks', 'syncStatus']
const CHECK_RESOURCES: WorktreeResource[] = ['checks', 'pr']
const JIRA_RESOURCES: WorktreeResource[] = ['jira']
const REASON_PRIORITY: Record<WorktreeRefreshReason, number> = {
  manual: 6,
  'agent-done': 5,
  'git-mutation': 4,
  'pr-mutation': 4,
  'jira-mutation': 4,
  online: 3,
  external: 2,
  poll: 1,
}

const GIT_FILE_MUTATIONS = new Set([
  'add',
  'am',
  'apply',
  'checkout',
  'cherry-pick',
  'clean',
  'merge',
  'mv',
  'pull',
  'rebase',
  'reset',
  'restore',
  'revert',
  'rm',
  'stash',
  'switch',
])
const GIT_REMOTE_MUTATIONS = new Set(['fetch', 'push'])
const GIT_BRANCH_MUTATIONS = new Set(['branch', 'checkout', 'switch', 'worktree'])

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  const pushCurrent = () => {
    if (!current) return
    tokens.push(current)
    current = ''
  }

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      pushCurrent()
      continue
    }

    if (ch === '&' && command[i + 1] === '&') {
      pushCurrent()
      tokens.push('&&')
      i += 1
      continue
    }

    if (ch === '|' && command[i + 1] === '|') {
      pushCurrent()
      tokens.push('||')
      i += 1
      continue
    }

    if (ch === ';' || ch === '|' || ch === '(' || ch === ')') {
      pushCurrent()
      tokens.push(ch)
      continue
    }

    current += ch
  }

  pushCurrent()
  return tokens
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

function canStartCommand(tokens: string[], index: number): boolean {
  if (index === 0) return true
  let cursor = index - 1
  while (cursor >= 0 && isEnvAssignment(tokens[cursor])) cursor -= 1
  if (cursor < 0) return true
  return SHELL_DELIMITERS.has(tokens[cursor]) || SHELL_WRAPPERS.has(tokens[cursor])
}

function nextSubcommand(
  tokens: string[],
  start: number,
  flagsWithValues = new Set<string>()
): { token: string; index: number } | null {
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (SHELL_DELIMITERS.has(token)) return null
    if (isEnvAssignment(token)) continue
    if (token.startsWith('-')) {
      const [flag] = token.split('=')
      if (flagsWithValues.has(flag) && !token.includes('=')) i += 1
      continue
    }
    return { token, index: i }
  }
  return null
}

function hasFlagValue(tokens: string[], start: number, names: Set<string>): boolean {
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (SHELL_DELIMITERS.has(token)) return false
    const [flag, inlineValue] = token.split('=')
    if (names.has(flag)) {
      const value = inlineValue ?? tokens[i + 1]
      return Boolean(value)
    }
  }
  return false
}

function ghApiMethod(tokens: string[], start: number): string {
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (SHELL_DELIMITERS.has(token)) return 'GET'
    if (token === '-X' || token === '--method') return (tokens[i + 1] ?? 'GET').toUpperCase()
    if (token.startsWith('-X')) return token.slice(2).toUpperCase()
    if (token.startsWith('--method=')) return token.slice('--method='.length).toUpperCase()
  }
  return 'GET'
}

export function mergeCliRefreshPlans(current: CliRefreshPlan | null, next: CliRefreshPlan): CliRefreshPlan {
  if (!current) return next
  const resources = [...current.resources]
  for (const resource of next.resources) {
    if (!resources.includes(resource)) resources.push(resource)
  }
  const reason = REASON_PRIORITY[next.reason] > REASON_PRIORITY[current.reason] ? next.reason : current.reason
  return {
    resources,
    reason,
    force: current.force || next.force,
    refreshWorktrees: current.refreshWorktrees || next.refreshWorktrees,
    invalidateJiraCache: current.invalidateJiraCache || next.invalidateJiraCache,
  }
}

function plan(
  resources: WorktreeResource[],
  reason: WorktreeRefreshReason,
  options: Partial<Pick<CliRefreshPlan, 'refreshWorktrees' | 'invalidateJiraCache'>> = {}
): CliRefreshPlan {
  return {
    resources,
    reason,
    force: true,
    refreshWorktrees: options.refreshWorktrees ?? false,
    invalidateJiraCache: options.invalidateJiraCache ?? false,
  }
}

function classifyGit(tokens: string[], index: number): CliRefreshPlan | null {
  const subcommand = nextSubcommand(tokens, index + 1, GIT_GLOBAL_FLAGS_WITH_VALUES)
  if (!subcommand) return null
  const cmd = subcommand.token

  if (cmd === 'commit') return plan(GIT_REMOTE_RESOURCES, 'git-mutation')
  if (GIT_REMOTE_MUTATIONS.has(cmd)) return plan(GIT_REMOTE_RESOURCES, 'git-mutation', { refreshWorktrees: cmd === 'push' })
  if (GIT_BRANCH_MUTATIONS.has(cmd)) return plan(GIT_BRANCH_RESOURCES, 'git-mutation', { refreshWorktrees: true })
  if (GIT_FILE_MUTATIONS.has(cmd)) return plan(GIT_FILE_RESOURCES, 'git-mutation')
  return null
}

function classifyGh(tokens: string[], index: number): CliRefreshPlan | null {
  const topLevel = nextSubcommand(tokens, index + 1)
  if (!topLevel) return null
  const top = topLevel.token
  const sub = nextSubcommand(tokens, topLevel.index + 1)?.token

  if (top === 'pr') {
    if (sub === 'checkout') return plan(GIT_BRANCH_RESOURCES, 'pr-mutation', { refreshWorktrees: true })
    if (!sub || GH_PR_MUTATING_COMMANDS.has(sub)) return plan(PR_RESOURCES, 'pr-mutation', { refreshWorktrees: sub === 'create' })
    return null
  }

  if (top === 'run' && sub && GH_RUN_MUTATING_COMMANDS.has(sub)) {
    return plan(CHECK_RESOURCES, 'pr-mutation')
  }

  if (top === 'workflow' && sub && GH_WORKFLOW_MUTATING_COMMANDS.has(sub)) {
    return plan(CHECK_RESOURCES, 'pr-mutation')
  }

  if (top === 'api') {
    const method = ghApiMethod(tokens, topLevel.index + 1)
    if (GH_API_MUTATING_METHODS.has(method) || hasFlagValue(tokens, topLevel.index + 1, new Set(['-f', '-F', '--field', '--raw-field']))) {
      return plan(['pr', 'checks', 'syncStatus', 'jira'], 'pr-mutation', { invalidateJiraCache: true })
    }
  }

  return null
}

function classifyAcli(tokens: string[], index: number): CliRefreshPlan | null {
  const product = nextSubcommand(tokens, index + 1)
  if (product?.token !== 'jira') return null
  const entity = nextSubcommand(tokens, product.index + 1)
  if (entity?.token !== 'workitem') return null
  const action = nextSubcommand(tokens, entity.index + 1)
  if (!action || !ACLI_WORKITEM_MUTATING_COMMANDS.has(action.token)) return null
  return plan(JIRA_RESOURCES, 'jira-mutation', { invalidateJiraCache: true })
}

export function classifyCliRefreshCommand(command: string): CliRefreshPlan | null {
  const tokens = tokenizeShellCommand(command)
  let result: CliRefreshPlan | null = null

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!canStartCommand(tokens, i)) continue
    const next =
      token === 'git' ? classifyGit(tokens, i) :
      token === 'gh' ? classifyGh(tokens, i) :
      token === 'acli' ? classifyAcli(tokens, i) :
      null
    if (next) result = mergeCliRefreshPlans(result, next)
  }

  return result
}
