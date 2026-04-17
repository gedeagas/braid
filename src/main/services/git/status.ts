import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { getValidGit } from './core'
import { ServiceCache } from '../../lib/serviceCache'
import { isBinaryFile } from '../../lib/binaryFile'
import type { FileEntry, GitChangeInfo } from './types'

const FILE_TREE_IGNORE = new Set(['.git', 'node_modules', '.DS_Store', '.claude'])

// ─── Caches ─────────────────────────────────────────────────────────────────
const trackedFilesCache = new ServiceCache<string[]>(60_000) // 1 min
const fileTreeCache = new ServiceCache<FileEntry[]>(30_000)  // 30s

/** Invalidate cached file tree for a worktree (call after file changes). */
export function invalidateFileTree(worktreePath: string): void {
  fileTreeCache.invalidateWhere((k) => k === worktreePath || k.startsWith(`${worktreePath}::`))
}

/** Invalidate cached tracked files for a worktree. */
export function invalidateTrackedFiles(worktreePath: string): void {
  trackedFilesCache.invalidate(worktreePath)
}

interface LineStats { additions: number; deletions: number }

/**
 * Parse `git diff --numstat` output into a file-keyed map.
 * Format: `<additions>\t<deletions>\t<path>` per line. Binary files emit '-' for counts.
 * Filenames may contain tabs, so the path is everything after the second tab.
 */
function parseNumstat(raw: string): Map<string, LineStats> {
  const map = new Map<string, LineStats>()
  for (const line of raw.split('\n')) {
    if (!line) continue
    const firstTab = line.indexOf('\t')
    if (firstTab < 0) continue
    const secondTab = line.indexOf('\t', firstTab + 1)
    if (secondTab < 0) continue
    const add = line.slice(0, firstTab)
    const del = line.slice(firstTab + 1, secondTab)
    const file = line.slice(secondTab + 1)
    // Binary files show '-' for both counts
    if (add === '-' || del === '-') continue
    const additions = parseInt(add, 10)
    const deletions = parseInt(del, 10)
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue
    map.set(file, { additions, deletions })
  }
  return map
}

// `-c core.quotePath=false` forces literal UTF-8 paths instead of octal-escaped
// quoted strings, so lookups by path match regardless of locale (e.g. Japanese filenames).
const NUMSTAT_ARGS_UNSTAGED = ['-c', 'core.quotePath=false', 'diff', '--numstat']
const NUMSTAT_ARGS_STAGED = ['-c', 'core.quotePath=false', 'diff', '--cached', '--numstat']

export async function getStatus(worktreePath: string): Promise<GitChangeInfo[]> {
  const git = await getValidGit(worktreePath)
  if (!git) return []

  // Fetch status and numstat in parallel for both indexes
  const [status, unstagedNumstat, stagedNumstat] = await Promise.all([
    git.status(),
    git.raw(NUMSTAT_ARGS_UNSTAGED).catch(() => ''),
    git.raw(NUMSTAT_ARGS_STAGED).catch(() => ''),
  ])

  const unstagedStats = parseNumstat(unstagedNumstat)
  const stagedStats = parseNumstat(stagedNumstat)

  const changes: GitChangeInfo[] = []

  for (const f of status.files) {
    const file = f.path

    // Index (staged) status
    if (f.index && f.index !== ' ' && f.index !== '?') {
      const mapped =
        f.index === 'M' ? 'M' :
        f.index === 'A' ? 'A' :
        f.index === 'D' ? 'D' :
        f.index === 'R' ? 'R' : null
      if (mapped) {
        const stat = stagedStats.get(file)
        changes.push({ file, status: mapped, staged: true, additions: stat?.additions, deletions: stat?.deletions })
      }
    }

    // Working directory (unstaged) status
    if (f.working_dir && f.working_dir !== ' ') {
      const mapped =
        f.working_dir === 'M' ? 'M' :
        f.working_dir === 'D' ? 'D' :
        f.working_dir === '?' ? '?' : null
      if (mapped) {
        const stat = unstagedStats.get(file)
        changes.push({ file, status: mapped, staged: false, additions: stat?.additions, deletions: stat?.deletions })
      }
    }
  }

  return changes
}

export async function getDiff(worktreePath: string): Promise<string> {
  const git = await getValidGit(worktreePath)
  if (!git) return ''
  return await git.diff()
}

export async function getFileDiff(worktreePath: string, file: string, status: string, staged: boolean): Promise<string> {
  const git = await getValidGit(worktreePath)
  if (!git) return ''
  try {
    if (status === '?') {
      // Untracked binary files cannot be read as UTF-8
      if (isBinaryFile(file)) {
        return `Binary file ${file} (untracked)`
      }
      // Untracked — show full file contents as pure additions
      const content = readFileSync(join(worktreePath, file), 'utf-8')
      const lines = content.split('\n')
      // split('\n') on a newline-terminated file produces a trailing empty string — drop it
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      const header = `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n`
      return header + lines.map((l) => `+${l}`).join('\n')
    }
    if (staged) {
      return await git.diff(['--cached', '--', file])
    }
    if (status === 'D') {
      // Deleted — diff against HEAD
      return await git.diff(['HEAD', '--', file])
    }
    return await git.diff(['--', file])
  } catch {
    return ''
  }
}

export async function getStagedDiff(worktreePath: string): Promise<string> {
  const git = await getValidGit(worktreePath)
  if (!git) return ''
  return await git.diff(['--cached'])
}

export async function getStagedFiles(worktreePath: string): Promise<string[]> {
  const git = await getValidGit(worktreePath)
  if (!git) return []
  const result = await git.diff(['--cached', '--name-only'])
  return result.split('\n').filter(Boolean)
}

export async function getFileTree(worktreePath: string, subPath = '', forceRefresh?: boolean): Promise<FileEntry[]> {
  const cacheKey = subPath ? `${worktreePath}::${subPath}` : worktreePath
  return fileTreeCache.get(cacheKey, () => _fetchFileTree(worktreePath, subPath), { forceRefresh })
}

async function _fetchFileTree(worktreePath: string, subPath: string): Promise<FileEntry[]> {
  const fullPath = subPath ? join(worktreePath, subPath) : worktreePath
  const entries: FileEntry[] = []

  try {
    const items = readdirSync(fullPath)
    const statted: { name: string; isDir: boolean }[] = []
    for (const name of items) {
      if (FILE_TREE_IGNORE.has(name)) continue
      try {
        const s = statSync(join(fullPath, name))
        statted.push({ name, isDir: s.isDirectory() })
      } catch {
        // skip inaccessible files
      }
    }
    statted.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    for (const { name, isDir } of statted) {
      entries.push({ name, path: relative(worktreePath, join(fullPath, name)), isDirectory: isDir })
    }
  } catch {
    // directory doesn't exist
  }
  return entries
}

export async function getTrackedFiles(worktreePath: string): Promise<string[]> {
  return trackedFilesCache.get(worktreePath, () => _fetchTrackedFiles(worktreePath))
}

async function _fetchTrackedFiles(worktreePath: string): Promise<string[]> {
  const git = await getValidGit(worktreePath)
  if (!git) return []
  try {
    const raw = await git.raw(['ls-files'])
    return raw.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

export async function readFile(filePath: string): Promise<string> {
  return readFileSync(filePath, 'utf-8')
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  writeFileSync(filePath, content, 'utf-8')
}

/** Max file size for base64 encoding (10 MB). Larger files return size only. */
const MAX_BASE64_SIZE = 10 * 1024 * 1024

/**
 * Read a file as base64. Returns { base64, size } or { base64: null, size } for oversized files.
 * Returns null if the file doesn't exist.
 */
export async function readFileAsBase64(filePath: string): Promise<{ base64: string | null; size: number } | null> {
  try {
    const size = statSync(filePath).size
    if (size > MAX_BASE64_SIZE) return { base64: null, size }
    const buf = readFileSync(filePath)
    return { base64: buf.toString('base64'), size: buf.length }
  } catch {
    return null
  }
}

/** Get file size in bytes without reading content. */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}
