import { execFile } from 'child_process'
import { promisify } from 'util'
import { LinearClient } from '@linear/sdk'
import { ServiceCache } from '../lib/serviceCache'

const exec = promisify(execFile)

export interface LinearIssue {
  key: string
  summary: string
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done'
  /** issue.priorityLabel or empty string */
  type: string
  assignee: string | null
  url: string
}

export interface LinearResult {
  /** false when no API key is configured */
  available: boolean
  issues: LinearIssue[]
}

// Maps Linear workflow state types to the tri-state category used by the UI.
const STATE_CATEGORY_MAP: Record<string, LinearIssue['statusCategory']> = {
  triage:    'new',
  backlog:   'new',
  unstarted: 'new',
  started:   'indeterminate',
  completed: 'done',
  canceled:  'done',
}

class LinearService {
  // Cache parsed issue data by "${key}:${apiKey.slice(-8)}" — 5 min TTL.
  // Including the key suffix prevents one user's cache from serving another key's results.
  private issueCache = new ServiceCache<LinearIssue | null>(300_000)

  /** Returns true when a non-empty API key is configured. */
  async isAvailable(apiKey: string): Promise<boolean> {
    return apiKey.trim().length > 0
  }

  /**
   * Validates an API key by making a lightweight viewer query.
   * Use this for the "Test Connection" button in settings.
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey.trim()) return false
    try {
      const client = new LinearClient({ apiKey })
      await client.viewer
      return true
    } catch {
      return false
    }
  }

  async getIssuesForBranch(worktreePath: string, apiKey: string): Promise<LinearResult> {
    if (!apiKey.trim()) return { available: false, issues: [] }

    const branch = await this.getBranchName(worktreePath)
    const keys = this.extractKeys(branch)
    if (keys.length === 0) return { available: true, issues: [] }

    const results = await Promise.allSettled(keys.map((k) => this.getIssue(k, apiKey)))
    const issues = results
      .filter((r): r is PromiseFulfilledResult<LinearIssue | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((i): i is LinearIssue => i !== null)

    return { available: true, issues }
  }

  /**
   * Fetch a single Linear issue by identifier (e.g. "ENG-123").
   * Returns null if the key is not found or the fetch fails.
   */
  async getIssueByKey(key: string, apiKey: string): Promise<LinearIssue | null> {
    if (!apiKey.trim()) return null
    return this.getIssue(key, apiKey)
  }

  private async getIssue(key: string, apiKey: string): Promise<LinearIssue | null> {
    const cacheKey = `${key}:${apiKey.slice(-8)}`
    return this.issueCache.get(cacheKey, async () => {
      try {
        const client = new LinearClient({ apiKey })
        // searchIssues is the type-safe way to look up by identifier string
        const result = await client.searchIssues(key)
        // Find the exact identifier match (search may return partial matches)
        const issue = result.nodes.find((n) => n.identifier === key)
        if (!issue) return null

        const [state, assigneeUser] = await Promise.all([issue.state, issue.assignee])
        return this.parseIssue(issue, state, assigneeUser)
      } catch {
        return null
      }
    })
  }

  private parseIssue(
    issue: { identifier: string; title: string; url: string; priorityLabel: string },
    state: { name: string; type: string } | undefined | null,
    assigneeUser: { name: string } | undefined | null,
  ): LinearIssue {
    const statusName = state?.name ?? 'Unknown'
    const stateType = (state?.type ?? '').toLowerCase()
    const statusCategory: LinearIssue['statusCategory'] =
      STATE_CATEGORY_MAP[stateType] ?? 'new'

    return {
      key: issue.identifier,
      summary: issue.title,
      status: statusName,
      statusCategory,
      type: issue.priorityLabel ?? '',
      assignee: assigneeUser?.name ?? null,
      url: issue.url,
    }
  }

  private async getBranchName(worktreePath: string): Promise<string> {
    try {
      const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: worktreePath,
        timeout: 3_000,
      })
      return stdout.trim()
    } catch {
      return ''
    }
  }

  /** Extract Linear issue identifiers from a branch name (e.g. ENG-123). */
  private extractKeys(branchName: string): string[] {
    const upper = branchName.toUpperCase()
    const matches = upper.match(/\b[A-Z]{2,10}-\d+\b/g)
    return matches ? [...new Set(matches)] : []
  }
}

export const linearService = new LinearService()
