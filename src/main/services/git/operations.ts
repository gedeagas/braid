import { unlinkSync } from 'fs'
import { join } from 'path'
import { getValidGit } from './core'

export async function push(worktreePath: string): Promise<void> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)
  // Check if the current branch has an upstream tracking branch.
  // If not, push with -u origin HEAD to set one automatically.
  try {
    const tracking = await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    if (tracking.trim()) {
      await git.push()
      return
    }
  } catch {
    // No upstream set — fall through to push -u
  }
  await git.push(['-u', 'origin', 'HEAD'])
}

export async function pull(worktreePath: string, strategy?: 'rebase' | 'merge'): Promise<{ alreadyUpToDate: boolean }> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)
  try {
    const opts = strategy === 'rebase' ? ['--rebase'] : strategy === 'merge' ? ['--no-rebase'] : []
    const result = opts.length ? await git.pull(opts) : await git.pull()
    return { alreadyUpToDate: result.files.length === 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Detect divergent branches — surface as sentinel so UI can show strategy dialog
    if (msg.includes('divergent branches') || msg.includes('Need to specify how to reconcile')) {
      throw new Error('DIVERGENT_BRANCHES')
    }
    // Surface a clean single-line error
    if (
      msg.includes('no tracking information') ||
      msg.includes('no upstream') ||
      msg.includes('has no upstream branch')
    ) {
      throw new Error('No upstream branch configured')
    }
    const firstLine = msg.split('\n').find((l) => l.trim()) ?? 'Pull failed'
    throw new Error(firstLine.replace(/^error:\s*/i, '').trim())
  }
}

export async function stageFiles(worktreePath: string, files: string[]): Promise<void> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)
  await git.add(files)
}

export async function unstageFiles(worktreePath: string, files: string[]): Promise<void> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)
  try {
    await git.reset(['--', ...files])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // On initial commit there is no HEAD ref; fall back to removing from index
    if (msg.includes('Failed to resolve') || msg.includes('unknown revision')) {
      await git.raw(['rm', '--cached', '--', ...files])
    } else {
      throw err
    }
  }
}

export async function discardChanges(worktreePath: string, file: string, status: string, staged?: boolean): Promise<void> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)
  if (staged) {
    if (status === 'A') {
      // New file — remove from index and delete from disk
      await git.raw(['rm', '-f', '--', file])
    } else {
      // Modified or deleted — restore from HEAD (discards staged + unstaged)
      await git.checkout(['HEAD', '--', file])
    }
  } else if (status === '?') {
    // Untracked file — delete it
    unlinkSync(join(worktreePath, file))
  } else {
    // Tracked file — restore from index
    await git.checkout(['--', file])
  }
}

export async function commit(worktreePath: string, message: string): Promise<void> {
  const git = await getValidGit(worktreePath)
  if (!git) throw new Error(`Not a git repository: ${worktreePath}`)
  await git.commit(message)
}
