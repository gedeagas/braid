// ---------------------------------------------------------------------------
// Per-turn git snapshots for the experimental chat rollback feature.
//
// Snapshots are detached commit SHAs that capture the worktree's full state
// (tracked + untracked files) at a point in time. They do NOT modify:
//   - the working tree
//   - the index (we temporarily add and restore the original index)
//   - any branch refs
//
// The resulting commit is reachable only by the SHA we record. When the
// session is deleted, git GC eventually reclaims the objects.
// ---------------------------------------------------------------------------

import { getValidGit } from './core'

/**
 * Create a snapshot commit of the current worktree state and return its SHA.
 *
 * Strategy (preserves index and working tree, does not touch branches):
 *   1. Save the current index SHA via git write-tree (for restore later)
 *   2. git add -A (stage everything including untracked)
 *   3. git write-tree -> dirty tree SHA
 *   4. Restore the original index via git read-tree
 *   5. git commit-tree <dirty-tree> -p HEAD -m "braid:snapshot" -> snap SHA
 *
 * If the worktree has no HEAD yet (brand-new repo), fall back to a parent-less
 * commit.
 */
export async function createSnapshot(worktreePath: string): Promise<string> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)

  // 1. Stash the current index tree so we can restore it afterwards.
  //    If the repo has nothing in the index this still works - returns the
  //    empty tree or an existing tree.
  const originalIndexTree = (await git.raw(['write-tree'])).trim()

  try {
    // 2. Stage every file (including untracked, excluding gitignored).
    await git.raw(['add', '-A'])

    // 3. Snapshot tree = everything currently staged.
    const snapTree = (await git.raw(['write-tree'])).trim()

    // 4. Restore the original index - caller's staging area is untouched.
    //    read-tree --reset would also touch the working tree; -m is a no-op
    //    merge that just replaces the index.
    await git.raw(['read-tree', originalIndexTree])

    // 5. Build the commit object. If HEAD doesn't exist (fresh repo), omit -p.
    let headSha: string | null = null
    try {
      headSha = (await git.raw(['rev-parse', 'HEAD'])).trim()
    } catch {
      headSha = null
    }

    const args = ['commit-tree', snapTree, '-m', 'braid:snapshot']
    if (headSha) {
      args.push('-p', headSha)
    }
    const snapSha = (await git.raw(args)).trim()
    if (!snapSha) throw new Error('git commit-tree returned empty SHA')
    return snapSha
  } catch (err) {
    // Best-effort: always try to restore the original index even on failure.
    try {
      await git.raw(['read-tree', originalIndexTree])
    } catch {}
    throw err
  }
}

/**
 * Restore the worktree to the state captured by a snapshot commit.
 *
 * We must handle two cases:
 *   - Files that existed in the snapshot are overwritten
 *   - Files that were created AFTER the snapshot need to be deleted
 *
 * Strategy:
 *   1. Diff the snapshot tree against the current worktree to find added
 *      files (present now, absent at snapshot time) and remove them
 *   2. git checkout <snap-sha> -- . to restore everything tracked by the snapshot
 */
export async function restoreSnapshot(worktreePath: string, snapSha: string): Promise<void> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)

  // Verify the snapshot object still exists. `cat-file -t` throws on missing
  // objects with a clear message.
  try {
    await git.raw(['cat-file', '-t', snapSha])
  } catch {
    throw new Error('SNAPSHOT_NOT_FOUND')
  }

  // Step 1: Find files that exist now but weren't in the snapshot tree.
  // git ls-tree -r --name-only <snap> lists every tracked file in the snapshot.
  // We compare against ls-files (current tracked) and untracked files separately.
  const snapFilesRaw = await git.raw(['ls-tree', '-r', '--name-only', snapSha])
  const snapFiles = new Set(snapFilesRaw.split('\n').map((l) => l.trim()).filter(Boolean))

  // Tracked + modified files in worktree
  const currentTrackedRaw = await git.raw(['ls-files'])
  const currentTracked = currentTrackedRaw.split('\n').map((l) => l.trim()).filter(Boolean)

  // Untracked (but not gitignored) files - these are the main thing to remove
  // because they were probably created by tool calls we're rolling back.
  const untrackedRaw = await git.raw(['ls-files', '--others', '--exclude-standard'])
  const untracked = untrackedRaw.split('\n').map((l) => l.trim()).filter(Boolean)

  const filesToRemove = [...currentTracked, ...untracked].filter((f) => !snapFiles.has(f))

  // Remove files not present in the snapshot. Use rm -f so missing files don't throw.
  // We run in small batches to avoid arg-list limits.
  const BATCH = 100
  for (let i = 0; i < filesToRemove.length; i += BATCH) {
    const batch = filesToRemove.slice(i, i + BATCH)
    try {
      await git.raw(['rm', '-f', '--quiet', '--', ...batch])
    } catch {
      // Some files may be untracked - fall through, they'll be handled by fs
    }
  }
  // For any still-existing untracked files, delete via git clean scoped to paths.
  // Easier: use `rm` via node fs for leftover untracked entries we couldn't stage.
  // git rm -f fails on untracked; we handle those by explicitly unlinking.
  if (filesToRemove.length > 0) {
    const { unlinkSync, rmdirSync } = await import('fs')
    const { join, dirname } = await import('path')
    const dirsToCheck = new Set<string>()
    for (const rel of filesToRemove) {
      try {
        unlinkSync(join(worktreePath, rel))
      } catch {
        // File may already be gone
      }
      // Collect parent directories for cleanup
      let dir = dirname(rel)
      while (dir && dir !== '.') {
        dirsToCheck.add(dir)
        dir = dirname(dir)
      }
    }
    // Remove empty directories, deepest first
    const sorted = [...dirsToCheck].sort((a, b) => b.length - a.length)
    for (const dir of sorted) {
      try {
        rmdirSync(join(worktreePath, dir))
      } catch {
        // Not empty or already gone
      }
    }
  }

  // Step 2: Restore all files from the snapshot tree to the working tree.
  //   git checkout <snap-sha> -- .
  // This overwrites tracked files AND creates any files that are in the
  // snapshot but missing from the worktree. Does NOT modify HEAD or refs.
  await git.raw(['checkout', snapSha, '--', '.'])
}
