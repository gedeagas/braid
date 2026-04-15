import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { ServiceCache } from '../lib/serviceCache'
import { enrichedEnv } from '../lib/enrichedEnv'

const exec = promisify(execFile)

export interface JiraIssue {
  key: string
  summary: string
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done'
  type: string
  assignee: string | null
  url: string
}

export interface JiraResult {
  available: boolean
  issues: JiraIssue[]
}

class JiraService {
  // Cached per app session — acli installation doesn't change at runtime
  private _available: boolean | null = null

  // Base URL detection cache: undefined = not yet attempted
  private _baseUrlDetected = false
  private _detectedBaseUrl: string | null = null

  // Cache raw acli JSON by issue key — 5 min TTL.
  // We cache the raw data (not the parsed JiraIssue) so URL construction uses
  // the current overrideUrl/detectedUrl at read time, not stale values from cache time.
  private issueDataCache = new ServiceCache<Record<string, unknown> | null>(300_000)

  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available
    try {
      await exec('which', ['acli'], { timeout: 3_000, env: enrichedEnv() })
      this._available = true
    } catch {
      this._available = false
    }
    return this._available
  }

  async recheckAvailability(): Promise<boolean> {
    this._available = null
    return this.isAvailable()
  }

  /**
   * Detect the Jira base URL from the jira-cli config file.
   * jira-cli (ankitpokhrel/jira-cli) stores `server: https://yoursite.atlassian.net`
   * at ~/.config/.jira/.config.yml — tried in priority order.
   */
  private async detectBaseUrl(): Promise<string | null> {
    const candidates = [
      join(homedir(), '.config', '.jira', '.config.yml'),
      join(homedir(), '.config', 'jira', '.config.yml'),
      join(homedir(), '.jira', '.config.yml'),
      join(homedir(), '.jira.yml'),
    ]

    for (const candidate of candidates) {
      try {
        const content = await readFile(candidate, 'utf8')
        // Match `server: https://company.atlassian.net` (with optional quotes)
        const match = content.match(/^server:\s*['"]?(https?:\/\/[^\s'"]+)['"]?\s*$/m)
        if (match?.[1]) return match[1].replace(/\/+$/, '')
      } catch {
        // File not found — try next candidate
      }
    }

    return null
  }

  private async getDetectedBaseUrl(): Promise<string | null> {
    if (!this._baseUrlDetected) {
      this._detectedBaseUrl = await this.detectBaseUrl()
      this._baseUrlDetected = true
    }
    return this._detectedBaseUrl
  }

  /**
   * @param overrideBaseUrl Optional URL from user settings — takes priority over everything.
   */
  async getIssuesForBranch(worktreePath: string, overrideBaseUrl?: string): Promise<JiraResult> {
    const available = await this.isAvailable()
    if (!available) return { available: false, issues: [] }

    const branch = await this.getBranchName(worktreePath)
    const keys = this.extractKeys(branch)
    if (keys.length === 0) return { available: true, issues: [] }

    // Detect now so it's ready, but don't merge yet — parseIssue applies priority.
    const detectedUrl = await this.getDetectedBaseUrl()
    const overrideUrl = overrideBaseUrl?.trim() || null

    const results = await Promise.allSettled(keys.map((k) => this.getIssue(k, overrideUrl, detectedUrl)))
    const issues = results
      .filter((r): r is PromiseFulfilledResult<JiraIssue | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((i): i is JiraIssue => i !== null)

    return { available: true, issues }
  }

  private async getIssue(key: string, overrideUrl: string | null, detectedUrl: string | null): Promise<JiraIssue | null> {
    const data = await this.issueDataCache.get(key, async () => {
      try {
        const { stdout } = await exec('acli', ['jira', 'workitem', 'view', key, '--json'], {
          timeout: 10_000,
          env: enrichedEnv()
        })
        return JSON.parse(stdout.trim()) as Record<string, unknown>
      } catch {
        return null
      }
    })
    if (!data) return null
    return this.parseIssue(data, overrideUrl, detectedUrl)
  }

  private parseIssue(data: Record<string, unknown>, overrideUrl: string | null, detectedUrl: string | null): JiraIssue | null {
    const fields = data.fields as Record<string, unknown> | undefined
    if (!fields || !data.key) return null

    const key = data.key as string
    const summary = (fields.summary as string) ?? ''
    const statusObj = fields.status as Record<string, unknown> | undefined
    const status = (statusObj?.name as string) ?? 'Unknown'
    const statusCategoryKey =
      ((statusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new'
    const type = ((fields.issuetype as Record<string, unknown>)?.name as string) ?? ''
    const assigneeObj = fields.assignee as Record<string, unknown> | null | undefined
    const assignee = (assigneeObj?.displayName as string) ?? null

    // URL priority: 1) settings override  2) self field (ground truth from API)  3) jira-cli auto-detect
    const self = (data.self as string) ?? ''
    const selfBaseUrl = self.match(/^(https?:\/\/[^/]+)/)?.[1] ?? ''
    const baseUrl = overrideUrl || selfBaseUrl || detectedUrl || ''
    const url = baseUrl ? `${baseUrl}/browse/${key}` : ''

    const statusCategory: 'new' | 'indeterminate' | 'done' =
      statusCategoryKey === 'done'
        ? 'done'
        : statusCategoryKey === 'indeterminate'
          ? 'indeterminate'
          : 'new'

    return { key, summary, status, statusCategory, type, assignee, url }
  }

  /**
   * Fetch a single Jira issue by key (e.g. "PROJ-1234").
   * Returns null if acli is not installed, key is not found, or fetch fails.
   */
  async getIssueByKey(key: string, overrideBaseUrl?: string): Promise<JiraIssue | null> {
    const available = await this.isAvailable()
    if (!available) return null
    const detectedUrl = await this.getDetectedBaseUrl()
    const overrideUrl = overrideBaseUrl?.trim() || null
    return this.getIssue(key, overrideUrl, detectedUrl)
  }

  private async getBranchName(worktreePath: string): Promise<string> {
    try {
      const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: worktreePath,
        timeout: 3_000
      })
      return stdout.trim()
    } catch {
      return ''
    }
  }

  /** Extract Jira issue keys from a branch name (case-insensitive, e.g. proj-1234 → PROJ-1234).
   *  Project key must be 2–10 letters only (no digits), matching Jira's own validation rules. */
  private extractKeys(branchName: string): string[] {
    const upper = branchName.toUpperCase()
    const matches = upper.match(/\b[A-Z]{2,10}-\d+\b/g)
    return matches ? [...new Set(matches)] : []
  }
}

export const jiraService = new JiraService()
