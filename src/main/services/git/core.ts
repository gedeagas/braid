import simpleGit, { SimpleGit } from 'simple-git'
import { existsSync } from 'fs'

export const NOISE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'build', 'out',
  'vendor', '.cache', 'coverage', '__pycache__', 'target',
])

export function getGit(repoPath: string): SimpleGit {
  return simpleGit(repoPath)
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
