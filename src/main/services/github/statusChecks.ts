import { getGit } from "../git/core"
import { GitHubTasks } from "./tasks"
import { resolveNwo } from "./core"
import type { CheckRun, Deployment, PrStatus } from "./types"

export abstract class GitHubStatusChecks extends GitHubTasks {
  async getPrStatus(worktreePath: string, forceRefresh?: boolean): Promise<PrStatus | null> {
    return this.prCache.get(worktreePath, () => this._fetchPrStatus(worktreePath), { forceRefresh })
  }

  protected async _fetchPrStatus(worktreePath: string): Promise<PrStatus | null> {
    const raw = await this.gh(
      ['pr', 'view', '--json', 'number,title,state,url,headRefName,mergeable,isDraft,baseRefName,reviewDecision,mergeStateStatus'],
      worktreePath
    )
    if (!raw) return null
    try {
      const data = JSON.parse(raw)
      return {
        number: data.number,
        title: data.title,
        state: data.state,
        url: data.url,
        headBranch: data.headRefName,
        mergeable: data.mergeable,
        isDraft: data.isDraft ?? false,
        baseRefName: data.baseRefName ?? 'main',
        reviewDecision: data.reviewDecision ?? '',
        mergeStateStatus: data.mergeStateStatus ?? ''
      }
    } catch {
      return null
    }
  }

  async getChecks(worktreePath: string, forceRefresh?: boolean): Promise<CheckRun[]> {
    return this.checksCache.get(worktreePath, () => this._fetchChecks(worktreePath, forceRefresh), { forceRefresh })
  }

  protected async _fetchChecks(worktreePath: string, forceRefresh?: boolean): Promise<CheckRun[]> {
    const nwo = await resolveNwo(worktreePath)
    const pr = await this.getPrStatus(worktreePath, forceRefresh)
    if (!pr) return []
    return this._fetchChecksForPr(worktreePath, nwo, pr.number)
  }

  protected async _fetchChecksForPr(repoPath: string, nwo: string, prNumber: number): Promise<CheckRun[]> {
    // gh pr checks --json only supports: bucket,completedAt,description,event,link,name,startedAt,state,workflow
    const raw = await this.gh(
      ['pr', 'checks', String(prNumber), '--repo', nwo, '--json', 'name,state,bucket,link,startedAt,completedAt,workflow'],
      repoPath
    )
    if (!raw) return []
    try {
      const data = JSON.parse(raw)
      return (
        data as Array<{
          name: string
          state: string
          bucket: string
          link: string
          startedAt?: string | null
          completedAt?: string | null
          workflow?: string | null
        }>
      ).map((c) => {
        // Map bucket (pass/fail/pending/skipping/cancel) to conclusion
        let conclusion: string | null = null
        if (c.bucket === 'pass') conclusion = 'success'
        else if (c.bucket === 'fail') conclusion = 'failure'
        else if (c.bucket === 'cancel') conclusion = 'cancelled'
        else if (c.bucket === 'skipping') conclusion = 'skipped'

        // Map state to status: completed if bucket is pass/fail/cancel/skipping
        const status = (c.bucket === 'pending') ? 'in_progress' : 'completed'

        return {
          name: c.name,
          status,
          conclusion,
          url: c.link,
          startedAt: c.startedAt ?? null,
          completedAt: c.completedAt ?? null,
          workflowName: c.workflow ?? null
        }
      })
    } catch {
      return []
    }
  }

  async getDeployments(worktreePath: string, forceRefresh?: boolean): Promise<Deployment[]> {
    // Catch at this level so transient errors (NWO lookup, network) are NOT cached
    // by ServiceCache (it only caches resolved values). Next poll retries cleanly.
    try {
      return await this.deploymentsCache.get(worktreePath, () => this._fetchDeployments(worktreePath), { forceRefresh })
    } catch {
      return []
    }
  }

  protected async _fetchDeployments(worktreePath: string): Promise<Deployment[]> {
    // Let resolveNwo throw on failure — the public method catches it so the
    // error is not cached (ServiceCache only caches successful resolutions).
    const nwoRaw = await resolveNwo(worktreePath)

    // Get branch name from git
    const git = getGit(worktreePath)
    const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    if (!branch) return []

    const raw = await this.gh(
      [
        'api',
        `repos/${nwoRaw}/deployments?ref=${encodeURIComponent(branch)}&per_page=10`,
        '-q',
        '[.[] | {environment: .environment, id: .id}]'
      ],
      worktreePath
    )
    if (!raw) return []

    try {
      const deployments: Array<{ environment: string; id: number }> = JSON.parse(raw)
      if (!deployments.length) return []

      // Deduplicate by environment — keep most recent
      const envMap = new Map<string, { environment: string; id: number }>()
      for (const d of deployments) {
        if (!envMap.has(d.environment)) envMap.set(d.environment, d)
      }

      const results: Deployment[] = []
      for (const d of envMap.values()) {
        const statusRaw = await this.gh(
          [
            'api',
            `repos/${nwoRaw}/deployments/${d.id}/statuses?per_page=1`,
            '-q',
            '[.[0] | {state: .state, environment_url: .environment_url, updated_at: .updated_at}]'
          ],
          worktreePath
        )
        try {
          const statuses: Array<{
            state: string
            environment_url?: string
            updated_at?: string
          }> = JSON.parse(statusRaw || '[]')
          const latest = statuses[0]
          results.push({
            environment: d.environment,
            state: latest?.state ?? 'pending',
            url: latest?.environment_url,
            updatedAt: latest?.updated_at
          })
        } catch {
          results.push({ environment: d.environment, state: 'pending' })
        }
      }
      return results
    } catch {
      return []
    }
  }

}
