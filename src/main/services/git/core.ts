import simpleGit, { SimpleGit } from 'simple-git'
import { existsSync } from 'fs'
import { enrichedEnv } from '../../lib/enrichedEnv'

export const NOISE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'build', 'out',
  'vendor', '.cache', 'coverage', '__pycache__', 'target',
])

export function getGit(repoPath: string): SimpleGit {
  const git = simpleGit(repoPath)
  git.env(enrichedEnv())
  return git
}

/** Returns a SimpleGit instance if path is a valid git repo, null otherwise */
export async function getValidGit(repoPath: string): Promise<SimpleGit | null> {
  if (!existsSync(repoPath)) {
    console.warn('[Git] path does not exist:', repoPath)
    return null
  }
  const git = getGit(repoPath)
  try {
    await git.raw(['rev-parse', '--git-dir'])
    return git
  } catch {
    console.warn('[Git] not a git repo:', repoPath)
    return null
  }
}
