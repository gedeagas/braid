import { logger } from '../../lib/logger'
import { getGit } from './core'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { DATA_DIR_NAME } from '../../appBrand'
import { getValidGit } from './core'
import type { WorktreeInfo } from './types'

export async function getWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const git = await getValidGit(repoPath)
  if (!git) return []

  const result = await git.raw(['worktree', 'list', '--porcelain'])
  const worktrees: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}

  for (const line of result.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9) }
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '')
    } else if (line === 'bare') {
      current.isMain = true
    } else if (line === '') {
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? 'HEAD',
          isMain: worktrees.length === 0 // first is main
        })
      }
      current = {}
    }
  }
  // Flush the last worktree if git output had no trailing newline
  if (current.path) {
    worktrees.push({
      path: current.path,
      branch: current.branch ?? 'HEAD',
      isMain: worktrees.length === 0
    })
  }
  return worktrees
}

export async function addWorktree(
  repoPath: string,
  branch: string,
  projectName: string,
  baseBranch?: string,
  storagePath?: string
): Promise<void> {
  logger.debug('[Git] addWorktree', { repoPath, branch, projectName, baseBranch, storagePath })

  const git = await getValidGit(repoPath)
  if (!git) throw new Error(`Not a git repository: ${repoPath}`)
  // Sanitize for filesystem path only — slashes/dots are valid in git branch names
  const safeDirName = branch.replace(/[^a-zA-Z0-9_-]/g, '-')
  const baseDir = storagePath
    ? storagePath.replace(/^~/, homedir())
    : join(homedir(), DATA_DIR_NAME, 'worktrees')
  const targetPath = join(baseDir, projectName, safeDirName)
  logger.debug('[Git] targetPath:', targetPath)

  // Ensure parent directory exists
  mkdirSync(dirname(targetPath), { recursive: true })

  // If target already exists, pick a unique name
  let finalPath = targetPath
  if (existsSync(targetPath)) {
    let i = 2
    while (existsSync(`${targetPath}-${i}`)) i++
    finalPath = `${targetPath}-${i}`
    logger.debug('[Git] path existed, using:', finalPath)
  }

  const branches = await git.branchLocal()
  const branchExists = branches.all.includes(branch)
  logger.debug('[Git] localBranches', { all: branches.all, branchExists })

  try {
    if (branchExists) {
      // Existing branch — check it out as a worktree (baseBranch ignored)
      const cmd = ['worktree', 'add', finalPath, branch]
      logger.debug('[Git] running: git', cmd.join(' '))
      await git.raw(cmd)
    } else if (baseBranch) {
      // New branch forked from a specific base branch
      const cmd = ['worktree', 'add', '-b', branch, finalPath, baseBranch]
      logger.debug('[Git] running: git', cmd.join(' '))
      await git.raw(cmd)
    } else {
      // New branch from current HEAD
      const cmd = ['worktree', 'add', '-b', branch, finalPath]
      logger.debug('[Git] running: git', cmd.join(' '))
      await git.raw(cmd)
    }
    logger.debug('[Git] worktree created OK at', finalPath)
  } catch (err) {
    logger.error('[Git] addWorktree FAILED:', err)
    throw err
  }
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const git = await getValidGit(repoPath)
  if (!git) throw new Error(`Not a git repository: ${repoPath}`)
  await git.raw(['worktree', 'remove', worktreePath, '--force'])
}

/** Extract repo name from any git URL format (HTTPS, SSH, etc.) */
export function parseRepoName(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  // SSH format: git@host:owner/repo → extract the part after ':'
  if (cleaned.includes(':') && !cleaned.includes('://')) {
    cleaned = cleaned.split(':').pop() ?? cleaned
  }
  return cleaned.split('/').pop() || 'repo'
}

export type CloneErrorCode = 'auth' | 'not_found' | 'network' | 'disk' | 'unknown'

export class CloneError extends Error {
  code: CloneErrorCode
  constructor(code: CloneErrorCode, originalMessage: string) {
    super(originalMessage)
    this.name = 'CloneError'
    this.code = code
  }
}

function classifyCloneError(err: unknown): CloneErrorCode {
  const msg = String(err).toLowerCase()
  if (msg.includes('authentication') || msg.includes('permission denied') || msg.includes('could not read from remote')) return 'auth'
  if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('repository not found')) return 'not_found'
  if (msg.includes('could not resolve host') || msg.includes('unable to access') || msg.includes('connection')) return 'network'
  if (msg.includes('no space') || msg.includes('enospc')) return 'disk'
  return 'unknown'
}

/**
 * Clones a remote git URL into ~/${DATA_DIR_NAME}/repos/{repoName}/.
 * Returns the local path of the cloned repository.
 */
export async function cloneRepo(url: string, storagePath?: string): Promise<string> {
  const repoName = parseRepoName(url)
  // Clone into ~/Braid/repos/ (not ~/Braid/worktrees/) so the cloned repo
  // doesn't collide with worktrees created at ~/Braid/worktrees/{project}/{branch}/
  const baseDir = storagePath
    ? storagePath.replace(/^~/, homedir())
    : join(homedir(), DATA_DIR_NAME, 'repos')
  const targetPath = join(baseDir, repoName)

  mkdirSync(dirname(targetPath), { recursive: true })

  // Pick a unique path if the directory already exists
  let finalPath = targetPath
  if (existsSync(targetPath)) {
    let i = 2
    while (existsSync(`${targetPath}-${i}`)) i++
    finalPath = `${targetPath}-${i}`
  }

  const git = getGit(process.cwd())
  try {
    await git.clone(url, finalPath)
  } catch (err) {
    // Clean up partially-created directory
    try { rmSync(finalPath, { recursive: true, force: true }) } catch { /* ignore cleanup errors */ }
    throw new CloneError(classifyCloneError(err), String(err))
  }
  return finalPath
}
