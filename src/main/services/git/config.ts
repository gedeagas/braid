import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getGit, getValidGit, NOISE_DIRS } from './core'

export async function getRemoteUrl(repoPath: string): Promise<string> {
  const git = await getValidGit(repoPath)
  if (!git) return ''
  try {
    const url = await git.raw(['remote', 'get-url', 'origin'])
    return url.trim()
  } catch {
    return ''
  }
}

export async function getRemotes(repoPath: string): Promise<Array<{ name: string; url: string }>> {
  const git = await getValidGit(repoPath)
  if (!git) return []
  try {
    const raw = await git.raw(['remote', '-v'])
    const seen = new Set<string>()
    return raw.split('\n').filter(Boolean).reduce<Array<{ name: string; url: string }>>((acc, line) => {
      const [name, url] = line.split(/\s+/)
      if (name && url && !seen.has(name)) { seen.add(name); acc.push({ name, url }) }
      return acc
    }, [])
  } catch { return [] }
}

export async function getGitUserConfig(repoPath: string): Promise<{
  global: { name: string; email: string }
  local: { name: string | null; email: string | null }
}> {
  const git = await getValidGit(repoPath)
  if (!git) return { global: { name: '', email: '' }, local: { name: null, email: null } }
  const [globalName, globalEmail, localName, localEmail] = await Promise.all([
    git.raw(['config', '--global', 'user.name']).catch(() => ''),
    git.raw(['config', '--global', 'user.email']).catch(() => ''),
    git.raw(['config', '--local', 'user.name']).catch(() => null),
    git.raw(['config', '--local', 'user.email']).catch(() => null),
  ])
  return {
    global: { name: globalName.trim(), email: globalEmail.trim() },
    local: {
      name: localName !== null ? localName.trim() : null,
      email: localEmail !== null ? localEmail.trim() : null,
    },
  }
}

export async function setGitUserConfig(repoPath: string, name: string, email: string): Promise<void> {
  const git = await getValidGit(repoPath)
  if (!git) throw new Error(`Not a git repository: ${repoPath}`)
  await git.raw(['config', '--local', 'user.name', name])
  await git.raw(['config', '--local', 'user.email', email])
}

export async function clearGitUserConfig(repoPath: string): Promise<void> {
  const git = await getValidGit(repoPath)
  if (!git) throw new Error(`Not a git repository: ${repoPath}`)
  await git.raw(['config', '--local', '--unset', 'user.name']).catch(() => {})
  await git.raw(['config', '--local', '--unset', 'user.email']).catch(() => {})
}

/** Returns true only when repoPath is itself the root of a git repo (not a subdirectory). */
export async function isRepoRoot(repoPath: string): Promise<boolean> {
  if (!existsSync(repoPath)) return false
  try {
    const git = getGit(repoPath)
    const raw = await git.raw(['rev-parse', '--show-toplevel'])
    const toplevel = raw.trim().replace(/\/+$/, '')
    const input = repoPath.replace(/\/+$/, '')
    return toplevel === input
  } catch {
    return false
  }
}

/** Scans immediate children of parentPath for git repo roots. Excludes noise directories. */
export async function findChildRepos(parentPath: string): Promise<string[]> {
  if (!existsSync(parentPath)) return []
  let entries: import('fs').Dirent[]
  try {
    entries = readdirSync(parentPath, { withFileTypes: true })
  } catch {
    return []
  }
  const candidates = entries
    .filter((e) => e.isDirectory() && !NOISE_DIRS.has(e.name))
    .map((e) => join(parentPath, e.name))
  const results = await Promise.all(
    candidates.map(async (p) => ((await isRepoRoot(p)) ? p : null))
  )
  return results.filter((p): p is string => p !== null)
}
