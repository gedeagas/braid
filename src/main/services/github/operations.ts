import { spawn } from "child_process"
import { ServiceCache } from "../../lib/serviceCache"
import { enrichedEnv } from "../../lib/enrichedEnv"
import { getGit } from "../git/core"
import { fetchIfStale, resolveNwo } from "./core"
import { GitHubReviews } from "./reviews"
import type { GitSyncStatus } from "./types"

export class GitHubService extends GitHubReviews {
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
  protected ghTail(args: string[], cwd: string, tailChars: number): Promise<string> {
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
    this.reviewsCache.invalidate(worktreePath)
    this.invalidatePrDetail(worktreePath)
    this.invalidateWorkItems(worktreePath)
  }

  async markPrReady(worktreePath: string): Promise<void> {
    await this.gh(['pr', 'ready'], worktreePath, true)
    this.prCache.invalidate(worktreePath)
    this.invalidatePrDetail(worktreePath)
    this.invalidateWorkItems(worktreePath)
  }

  async mergePrByNumber(repoPath: string, number: number, strategy: 'merge' | 'squash' | 'rebase'): Promise<void> {
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const nwo = await resolveNwo(repoPath)
    const flag = strategy === 'squash' ? '--squash' : strategy === 'rebase' ? '--rebase' : '--merge'
    try {
      await this.gh(['pr', 'merge', String(normalizedNumber), flag, '--delete-branch', '--repo', nwo], repoPath, true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('already used by worktree')) throw err
    }
    this.invalidatePrDetail(repoPath, normalizedNumber)
    this.invalidateWorkItems(repoPath)
  }

  async closePrByNumber(repoPath: string, number: number): Promise<void> {
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const nwo = await resolveNwo(repoPath)
    await this.gh(['pr', 'close', String(normalizedNumber), '--repo', nwo], repoPath, true)
    this.invalidatePrDetail(repoPath, normalizedNumber)
    this.invalidateWorkItems(repoPath)
  }

  async markPrReadyByNumber(repoPath: string, number: number): Promise<void> {
    const normalizedNumber = Math.max(1, Math.round(number || 0))
    const nwo = await resolveNwo(repoPath)
    await this.gh(['pr', 'ready', String(normalizedNumber), '--repo', nwo], repoPath, true)
    this.invalidatePrDetail(repoPath, normalizedNumber)
    this.invalidateWorkItems(repoPath)
  }

  private avatarCache = new ServiceCache<string>(Infinity)

  async getOwnerAvatarUrl(cwd: string): Promise<string> {
    const nwo = await resolveNwo(cwd)
    try {
      return await this.avatarCache.get(nwo, async () => {
        const raw = await this.gh(
          ['api', `repos/${nwo}`, '--jq', '.owner.avatar_url'],
          cwd,
          true
        )
        const url = raw.trim()
        if (!url) throw new Error('Empty avatar URL')
        return url
      })
    } catch {
      return ''
    }
  }

  async getGitSyncStatus(worktreePath: string, baseBranch: string, _forceRefresh?: boolean): Promise<GitSyncStatus> {
    const result: GitSyncStatus = {
      uncommittedChanges: 0,
      behindCount: 0,
      aheadCount: 0,
      baseBranch
    }
    try {
      const git = getGit(worktreePath)
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
