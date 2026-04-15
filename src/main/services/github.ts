import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import simpleGit from 'simple-git'
import { ServiceCache } from '../lib/serviceCache'
import { enrichedEnv } from '../lib/enrichedEnv'

const exec = promisify(execFile)

// ─── Shared NWO resolver ─────────────────────────────────────────────────────
// nameWithOwner never changes for a repo — cache permanently per session.
// Used by both github.ts and git/branches.ts (via export).

const nwoCache = new ServiceCache<string>(Infinity)

/** Resolve the GitHub owner/repo for a worktree. Session-permanent cache. */
export async function resolveNwo(cwd: string): Promise<string> {
  return nwoCache.get(cwd, async () => {
    const { stdout } = await exec(
      'gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      { cwd, timeout: 15_000, env: enrichedEnv() }
    )
    const nwo = stdout.trim()
    if (!nwo) throw new Error('Could not resolve repo nameWithOwner')
    return nwo
  })
}

/** Debounced git-fetch: at most once per 30s per repo root. */
const fetchTimestamps = new Map<string, number>()
const FETCH_COOLDOWN_MS = 30_000

async function fetchIfStale(worktreePath: string): Promise<void> {
  const now = Date.now()
  const lastFetch = fetchTimestamps.get(worktreePath) ?? 0
  if (now - lastFetch < FETCH_COOLDOWN_MS) return

  fetchTimestamps.set(worktreePath, now)
  const git = simpleGit(worktreePath)
  await git.fetch(['--no-tags', '--prune', 'origin'])
}

export interface PrStatus {
  number: number
  title: string
  state: string
  url: string
  headBranch: string
  mergeable?: string
  isDraft?: boolean
  baseRefName?: string
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | '' (no review policy) */
  reviewDecision?: string
  /** BEHIND | BLOCKED | CLEAN | DIRTY | DRAFT | HAS_HOOKS | UNKNOWN | UNSTABLE */
  mergeStateStatus?: string
}

export interface CheckRun {
  name: string
  status: string
  conclusion: string | null
  url: string
  startedAt?: string | null
  completedAt?: string | null
  workflowName?: string | null
}

export interface Deployment {
  environment: string
  state: string
  url?: string
  updatedAt?: string
}

export interface GitSyncStatus {
  uncommittedChanges: number
  behindCount: number
  aheadCount: number
  baseBranch: string | null
}

class GitHubService {
  private prCache = new ServiceCache<PrStatus | null>(30_000)
  private checksCache = new ServiceCache<CheckRun[]>(30_000)
  private deploymentsCache = new ServiceCache<Deployment[]>(60_000)
  // Note: getGitSyncStatus is NOT cached — it reads uncommittedChanges from `git status`
  // which changes on every file save. The existing fetchIfStale() debounce already handles
  // the expensive network call (git fetch). git status + rev-list are fast local ops (~10ms).

  private async gh(args: string[], cwd: string, throwOnError = false): Promise<string> {
    try {
      const { stdout } = await exec('gh', args, { cwd, timeout: 15_000, maxBuffer: 10 * 1024 * 1024, env: enrichedEnv() })
      return stdout.trim()
    } catch (err) {
      if (throwOnError) {
        // execFile errors carry the real message in stderr — surface it
        const stderr = (err as { stderr?: string }).stderr?.trim()
        if (stderr) {
          const wrapped = new Error(stderr)
          wrapped.cause = err
          throw wrapped
        }
        throw err
      }
      return ''
    }
  }

  async getPrStatus(worktreePath: string, forceRefresh?: boolean): Promise<PrStatus | null> {
    return this.prCache.get(worktreePath, () => this._fetchPrStatus(worktreePath), { forceRefresh })
  }

  private async _fetchPrStatus(worktreePath: string): Promise<PrStatus | null> {
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
    return this.checksCache.get(worktreePath, () => this._fetchChecks(worktreePath), { forceRefresh })
  }

  private async _fetchChecks(worktreePath: string): Promise<CheckRun[]> {
    // gh pr checks --json only supports: bucket,completedAt,description,event,link,name,startedAt,state,workflow
    const raw = await this.gh(
      ['pr', 'checks', '--json', 'name,state,bucket,link,startedAt,completedAt,workflow'],
      worktreePath
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

  private async _fetchDeployments(worktreePath: string): Promise<Deployment[]> {
    // Let resolveNwo throw on failure — the public method catches it so the
    // error is not cached (ServiceCache only caches successful resolutions).
    const nwoRaw = await resolveNwo(worktreePath)

    // Get branch name from git
    const git = simpleGit(worktreePath)
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

  async getCheckRunLog(worktreePath: string, checkUrl: string): Promise<string> {
    // checkUrl from gh pr checks looks like:
    //   https://github.com/owner/repo/actions/runs/12345/jobs/67890
    // Note: it's /jobs/ (plural), not /job/
    const jobMatch = checkUrl.match(/\/jobs\/(\d+)/)
    const runMatch = checkUrl.match(/\/runs\/(\d+)/)
    if (!runMatch) return ''

    const runId = runMatch[1]
    const jobId = jobMatch?.[1]
    const target = jobId ? ['--job', jobId] : [runId]

    // Try --log-failed first (much smaller, only failed steps)
    try {
      const failed = await this.ghTail(['run', 'view', ...target, '--log-failed'], worktreePath, 20_000)
      if (failed) return failed
    } catch { /* fall through to full log */ }

    // Fall back to full log, streamed to avoid maxBuffer overflow
    return this.ghTail(['run', 'view', ...target, '--log'], worktreePath, 20_000)
  }

  /** Spawn `gh` and stream stdout, keeping only the last `tailChars` characters. */
  private ghTail(args: string[], cwd: string, tailChars: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('gh', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], env: enrichedEnv() })
      let tail = ''
      const timer = setTimeout(() => { proc.kill(); reject(new Error('gh log fetch timed out')) }, 30_000)

      proc.stdout.on('data', (chunk: Buffer) => {
        tail += chunk.toString()
        if (tail.length > tailChars * 2) tail = tail.slice(-tailChars)
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0 ? tail.slice(-tailChars) : '')
      })

      proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
  }

  async mergePr(worktreePath: string, strategy: 'merge' | 'squash' | 'rebase'): Promise<void> {
    const flag = strategy === 'squash' ? '--squash' : strategy === 'rebase' ? '--rebase' : '--merge'
    try {
      await this.gh(['pr', 'merge', flag, '--delete-branch'], worktreePath, true)
    } catch (err) {
      // gh pr merge --delete-branch tries to checkout the base branch locally
      // after merging. In a multi-worktree setup this fails because the base
      // branch (e.g. main) is already checked out by the root worktree.
      // The merge itself succeeded - only the local checkout failed.
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('already used by worktree')) throw err
    }
    this.prCache.invalidate(worktreePath)
    this.checksCache.invalidate(worktreePath)
    this.deploymentsCache.invalidate(worktreePath)
  }

  async markPrReady(worktreePath: string): Promise<void> {
    await this.gh(['pr', 'ready'], worktreePath, true)
    this.prCache.invalidate(worktreePath)
  }

  async getGitSyncStatus(worktreePath: string, baseBranch: string, _forceRefresh?: boolean): Promise<GitSyncStatus> {
    const result: GitSyncStatus = {
      uncommittedChanges: 0,
      behindCount: 0,
      aheadCount: 0,
      baseBranch
    }
    try {
      const git = simpleGit(worktreePath)
      const status = await git.status()
      result.uncommittedChanges =
        status.modified.length +
        status.created.length +
        status.deleted.length +
        status.not_added.length +
        status.renamed.length

      // Fetch latest remote refs so ahead/behind counts are accurate
      try {
        await fetchIfStale(worktreePath)
      } catch {
        // Network unavailable — fall through with stale refs
      }

      // Get ahead/behind vs remote base branch
      try {
        const remote = baseBranch.includes('/') ? baseBranch : `origin/${baseBranch}`
        const revList = await git.raw(['rev-list', '--left-right', '--count', `${remote}...HEAD`])
        const parts = revList.trim().split(/\s+/)
        result.behindCount = parseInt(parts[0] ?? '0', 10) || 0
        result.aheadCount = parseInt(parts[1] ?? '0', 10) || 0
      } catch {
        // remote may not be configured
      }
    } catch {
      // not a git repo
    }
    return result
  }
}

export const githubService = new GitHubService()
