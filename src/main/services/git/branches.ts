import { execFile } from 'child_process'
import { promisify } from 'util'
import { getValidGit } from './core'
import { ServiceCache } from '../../lib/serviceCache'
import { enrichedEnv } from '../../lib/enrichedEnv'
import { resolveNwo } from '../github'

const execFileAsync = promisify(execFile)

const remoteBranchesCache = new ServiceCache<{ branches: string[]; defaultBranch?: string }>(120_000) // 2 min
const branchProtectionCache = new ServiceCache<boolean>(1_800_000) // 30 min

export async function getBranches(repoPath: string): Promise<string[]> {
  const git = await getValidGit(repoPath)
  if (!git) return []
  const result = await git.branchLocal()
  return result.all
}

export async function getRemoteBranches(
  worktreePath: string,
  forceRefresh?: boolean
): Promise<{ branches: string[]; defaultBranch?: string }> {
  return remoteBranchesCache.get(worktreePath, () => _fetchRemoteBranches(worktreePath), { forceRefresh })
}

async function _fetchRemoteBranches(worktreePath: string): Promise<{ branches: string[]; defaultBranch?: string }> {
  // Try GitHub API first (includes branches not yet fetched locally)
  try {
    const repo = await resolveNwo(worktreePath)

    // Parallelize: default branch + branch list (independent of each other)
    const [defaultBranch, branches] = await Promise.all([
      execFileAsync('gh', ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], { cwd: worktreePath, timeout: 15_000, env: enrichedEnv() })
        .then(({ stdout }) => stdout.trim() || undefined)
        .catch(() => undefined),
      execFileAsync('gh', ['api', `repos/${repo}/branches`, '--paginate', '-q', '.[].name'], { cwd: worktreePath, timeout: 30_000, env: enrichedEnv() })
        .then(({ stdout }) => stdout.split('\n').map((b) => b.trim()).filter(Boolean).map((b) => `origin/${b}`)),
    ])

    console.log('[Git] gh branches count:', branches.length, 'default:', defaultBranch, 'cwd:', worktreePath)
    if (branches.length > 0) return { branches, defaultBranch: defaultBranch ? `origin/${defaultBranch}` : undefined }
  } catch (err) {
    console.warn('[Git] gh remote branches failed, falling back to git:', (err as Error).message)
  }

  // Fallback: local remote-tracking refs (always works after git fetch)
  try {
    const git = await getValidGit(worktreePath)
    if (!git) return { branches: [] }
    const raw = await git.raw(['branch', '-r', '--no-color'])
    const lines = raw.split('\n').map((b) => b.trim()).filter(Boolean)
    // Detect default branch from HEAD pointer (e.g. "origin/HEAD -> origin/main")
    const headLine = lines.find((l) => l.includes(' -> '))
    const defaultBranch = headLine ? headLine.split(' -> ')[1]?.trim() : undefined
    const branches = lines.filter((b) => !b.includes(' -> '))
    console.log('[Git] git branch -r count:', branches.length, 'default:', defaultBranch)
    return { branches, defaultBranch }
  } catch (err) {
    console.warn('[Git] git branch -r failed:', (err as Error).message)
    return { branches: [] }
  }
}

export async function setUpstream(worktreePath: string, branch: string, upstream: string): Promise<void> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)
  await git.raw(['branch', '--set-upstream-to', upstream, branch])
}

export async function renameBranch(worktreePath: string, oldName: string, newName: string): Promise<void> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)
  // Check if a branch with the new name already exists locally
  const branches = await git.branchLocal()
  if (branches.all.includes(newName)) {
    throw new Error(`A branch named '${newName}' already exists`)
  }
  await git.raw(['branch', '-m', oldName, newName])
}

export async function getTrackingBranch(worktreePath: string, branch: string): Promise<string | null> {
  const git = await getValidGit(worktreePath)
  if (!git) return null
  try {
    const upstream = await git.raw(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])
    return upstream.trim() || null
  } catch {
    return null
  }
}

/**
 * Checks whether a branch is protected on GitHub.
 * Returns true if protected, false if not protected or if gh is unavailable.
 * Cached for 30 minutes — branch protection rules rarely change.
 * Cache key uses nwo::branch so multiple worktrees for the same repo share the result.
 */
export async function isBranchProtected(worktreePath: string, branch: string): Promise<boolean> {
  try {
    const repo = await resolveNwo(worktreePath)
    return await branchProtectionCache.get(`${repo}::${branch}`, () => _checkProtected(repo, branch, worktreePath))
  } catch {
    // resolveNwo failed (gh not available) — not protected
    return false
  }
}

async function _checkProtected(repo: string, branch: string, cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/${repo}/branches/${encodeURIComponent(branch)}`, '-q', '.protected'],
      { cwd, timeout: 15_000, env: enrichedEnv() }
    )
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}
