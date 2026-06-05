import { execFile } from 'child_process'
import { promisify } from 'util'
import { ServiceCache } from '../../lib/serviceCache'
import { enrichedEnv } from '../../lib/enrichedEnv'
import { getGit } from '../git/core'
import type {
  CheckRun,
  Deployment,
  GitHubPrDetail,
  GitHubLabelSuggestion,
  GitHubReviewerSuggestion,
  GitSyncStatus,
  ListWorkItemsResult,
  PrReviewData,
  PrStatus,
} from './types'

const exec = promisify(execFile)

const nwoCache = new ServiceCache<string>(Infinity)

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

const fetchTimestamps = new Map<string, number>()
const FETCH_COOLDOWN_MS = 30_000

export async function fetchIfStale(worktreePath: string): Promise<void> {
  const now = Date.now()
  const lastFetch = fetchTimestamps.get(worktreePath) ?? 0
  if (now - lastFetch < FETCH_COOLDOWN_MS) return

  fetchTimestamps.set(worktreePath, now)
  const git = getGit(worktreePath)
  await git.fetch(['--no-tags', '--prune', 'origin'])
}

export abstract class GitHubCore {
  protected prCache = new ServiceCache<PrStatus | null>(30_000)
  protected checksCache = new ServiceCache<CheckRun[]>(30_000)
  protected deploymentsCache = new ServiceCache<Deployment[]>(60_000)
  protected reviewsCache = new ServiceCache<PrReviewData>(30_000)
  protected workItemsCache = new ServiceCache<ListWorkItemsResult>(60_000)
  protected workItemCountsCache = new ServiceCache<number>(120_000)
  protected prDetailCache = new ServiceCache<GitHubPrDetail>(30_000)
  protected reviewerSuggestionsCache = new ServiceCache<GitHubReviewerSuggestion[]>(60_000)
  protected labelSuggestionsCache = new ServiceCache<GitHubLabelSuggestion[]>(60_000)
  protected rateLimitCache = new ServiceCache<Record<string, { remaining: number; resetAt: number }>>(10_000)

  protected async gh(args: string[], cwd: string, throwOnError = false): Promise<string> {
    try {
      const { stdout } = await exec('gh', args, { cwd, timeout: 15_000, maxBuffer: 10 * 1024 * 1024, env: enrichedEnv() })
      return stdout.trim()
    } catch (err) {
      if (throwOnError) {
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

  protected async hasRateLimitBudget(cwd: string, resource: 'core' | 'graphql' | 'search', minRemaining: number): Promise<boolean> {
    try {
      const limits = await this.getRateLimits(cwd)
      const limit = limits[resource]
      if (!limit) return true
      return limit.remaining > minRemaining || limit.resetAt * 1000 <= Date.now()
    } catch {
      return true
    }
  }

  protected async assertRateLimitBudget(cwd: string, resource: 'core' | 'graphql' | 'search', minRemaining: number): Promise<void> {
    if (!await this.hasRateLimitBudget(cwd, resource, minRemaining)) {
      throw new Error(`GitHub ${resource} API rate limit is too low. Try again after the reset window.`)
    }
  }

  protected invalidatePrDetail(repoPath: string, number?: number): void {
    if (typeof number === 'number') {
      this.prDetailCache.invalidate(`${repoPath}::pr-detail::${number}`)
      return
    }
    this.prDetailCache.invalidateWhere((key) => key.startsWith(`${repoPath}::pr-detail::`))
  }

  protected invalidateWorkItems(repoPath: string): void {
    this.workItemsCache.invalidateWhere((key) => key.startsWith(`${repoPath}::`))
    this.workItemCountsCache.invalidateWhere((key) => key.startsWith(`${repoPath}::count::`))
  }

  private async getRateLimits(cwd: string): Promise<Record<string, { remaining: number; resetAt: number }>> {
    return this.rateLimitCache.get(cwd, async () => {
      const raw = await this.gh(['api', 'rate_limit'], cwd)
      const parsed = JSON.parse(raw || '{}') as {
        resources?: Record<string, { remaining?: number; reset?: number }>
      }
      const limits: Record<string, { remaining: number; resetAt: number }> = {}
      for (const [key, value] of Object.entries(parsed.resources ?? {})) {
        limits[key] = {
          remaining: Number(value.remaining) || 0,
          resetAt: Number(value.reset) || 0,
        }
      }
      return limits
    })
  }
}
