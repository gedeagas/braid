import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock simple-git ---
const mockRaw = vi.fn()
const mockEnv = vi.fn()
const mockGit = {
  raw: mockRaw,
  env: mockEnv
}
// .env() returns the same git instance for chaining
mockEnv.mockReturnValue(mockGit)

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}))

vi.mock('../../../lib/enrichedEnv', () => ({
  enrichedEnv: () => ({ ...process.env }),
}))

// --- Mock fs ---
const mockExistsSync = vi.fn()
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return { ...actual, existsSync: (p: string) => mockExistsSync(p) }
})

// --- Mock fs/promises (used by restoreSnapshot for file cleanup) ---
const mockUnlink = vi.fn()
const mockRmdir = vi.fn()
vi.mock('fs/promises', () => ({
  unlink: (...args: unknown[]) => mockUnlink(...args),
  rmdir: (...args: unknown[]) => mockRmdir(...args)
}))

import { createSnapshot, restoreSnapshot } from '../snapshots'

const REPO = '/repo'

beforeEach(() => {
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(true)
  mockRaw.mockResolvedValue('')
  mockEnv.mockReturnValue(mockGit)
  mockUnlink.mockResolvedValue(undefined)
  mockRmdir.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// createSnapshot
// ---------------------------------------------------------------------------

describe('createSnapshot', () => {
  it('returns the commit SHA from a successful snapshot', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'write-tree' && args.length === 1) return Promise.resolve('orig-tree-sha\n')
      if (args[0] === 'add') return Promise.resolve('')
      if (args[0] === 'write-tree') return Promise.resolve('snap-tree-sha\n')
      if (args[0] === 'read-tree') return Promise.resolve('')
      if (args[0] === 'rev-parse') return Promise.resolve('head-sha\n')
      if (args[0] === 'commit-tree') return Promise.resolve('snap-commit-sha\n')
      return Promise.resolve('')
    })

    // write-tree is called twice, track call order
    const writeTreeResults = ['orig-tree-sha\n', 'snap-tree-sha\n']
    let writeTreeIdx = 0
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'write-tree') return Promise.resolve(writeTreeResults[writeTreeIdx++])
      if (args[0] === 'add') return Promise.resolve('')
      if (args[0] === 'read-tree') return Promise.resolve('')
      if (args[0] === 'rev-parse') return Promise.resolve('head-sha\n')
      if (args[0] === 'commit-tree') return Promise.resolve('snap-commit-sha\n')
      return Promise.resolve('')
    })

    const sha = await createSnapshot(REPO)
    expect(sha).toBe('snap-commit-sha')
  })

  it('calls git add -A to stage all files', async () => {
    const calls: string[][] = []
    const writeTreeResults = ['orig-tree\n', 'snap-tree\n']
    let wtIdx = 0
    mockRaw.mockImplementation((args: string[]) => {
      calls.push(args)
      if (args[0] === 'write-tree') return Promise.resolve(writeTreeResults[wtIdx++])
      if (args[0] === 'add') return Promise.resolve('')
      if (args[0] === 'read-tree') return Promise.resolve('')
      if (args[0] === 'rev-parse') return Promise.resolve('head\n')
      if (args[0] === 'commit-tree') return Promise.resolve('sha\n')
      return Promise.resolve('')
    })

    await createSnapshot(REPO)
    expect(calls).toContainEqual(['add', '-A'])
  })

  it('restores original index after staging', async () => {
    const calls: string[][] = []
    const writeTreeResults = ['original-index\n', 'snap-tree\n']
    let wtIdx = 0
    mockRaw.mockImplementation((args: string[]) => {
      calls.push(args)
      if (args[0] === 'write-tree') return Promise.resolve(writeTreeResults[wtIdx++])
      if (args[0] === 'add') return Promise.resolve('')
      if (args[0] === 'read-tree') return Promise.resolve('')
      if (args[0] === 'rev-parse') return Promise.resolve('head\n')
      if (args[0] === 'commit-tree') return Promise.resolve('sha\n')
      return Promise.resolve('')
    })

    await createSnapshot(REPO)
    // read-tree should be called with the original index tree SHA
    expect(calls).toContainEqual(['read-tree', 'original-index'])
  })

  it('sets deterministic git identity for commit-tree', async () => {
    const writeTreeResults = ['orig\n', 'snap\n']
    let wtIdx = 0
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'write-tree') return Promise.resolve(writeTreeResults[wtIdx++])
      if (args[0] === 'add') return Promise.resolve('')
      if (args[0] === 'read-tree') return Promise.resolve('')
      if (args[0] === 'rev-parse') return Promise.resolve('head\n')
      if (args[0] === 'commit-tree') return Promise.resolve('sha\n')
      return Promise.resolve('')
    })

    await createSnapshot(REPO)
    expect(mockEnv).toHaveBeenCalledWith({
      GIT_AUTHOR_NAME: 'Braid',
      GIT_AUTHOR_EMAIL: 'braid@local',
      GIT_COMMITTER_NAME: 'Braid',
      GIT_COMMITTER_EMAIL: 'braid@local',
    })
  })

  it('omits -p HEAD when repo has no HEAD (fresh repo)', async () => {
    let commitTreeArgs: string[] = []
    const writeTreeResults = ['orig\n', 'snap-tree\n']
    let wtIdx = 0
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'write-tree') return Promise.resolve(writeTreeResults[wtIdx++])
      if (args[0] === 'add') return Promise.resolve('')
      if (args[0] === 'read-tree') return Promise.resolve('')
      // getValidGit calls rev-parse --git-dir (allow it), but HEAD lookup should fail
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return Promise.resolve('.git\n')
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return Promise.reject(new Error('no HEAD'))
      if (args[0] === 'commit-tree') { commitTreeArgs = args; return Promise.resolve('sha\n') }
      return Promise.resolve('')
    })

    await createSnapshot(REPO)
    expect(commitTreeArgs).not.toContain('-p')
  })

  it('includes -p HEAD when HEAD exists', async () => {
    let commitTreeArgs: string[] = []
    const writeTreeResults = ['orig\n', 'snap-tree\n']
    let wtIdx = 0
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'write-tree') return Promise.resolve(writeTreeResults[wtIdx++])
      if (args[0] === 'add') return Promise.resolve('')
      if (args[0] === 'read-tree') return Promise.resolve('')
      if (args[0] === 'rev-parse') return Promise.resolve('head-sha\n')
      if (args[0] === 'commit-tree') { commitTreeArgs = args; return Promise.resolve('sha\n') }
      return Promise.resolve('')
    })

    await createSnapshot(REPO)
    expect(commitTreeArgs).toContain('-p')
    expect(commitTreeArgs).toContain('head-sha')
  })

  it('throws when not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(createSnapshot(REPO)).rejects.toThrow('Not a git repository')
  })

  it('throws when commit-tree returns empty', async () => {
    const writeTreeResults = ['orig\n', 'snap\n']
    let wtIdx = 0
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'write-tree') return Promise.resolve(writeTreeResults[wtIdx++])
      if (args[0] === 'add') return Promise.resolve('')
      if (args[0] === 'read-tree') return Promise.resolve('')
      if (args[0] === 'rev-parse') return Promise.resolve('head\n')
      if (args[0] === 'commit-tree') return Promise.resolve('\n')
      return Promise.resolve('')
    })

    await expect(createSnapshot(REPO)).rejects.toThrow('git commit-tree returned empty SHA')
  })

  it('restores original index even when add -A fails', async () => {
    const calls: string[][] = []
    mockRaw.mockImplementation((args: string[]) => {
      calls.push(args)
      if (args[0] === 'write-tree') return Promise.resolve('orig-index\n')
      if (args[0] === 'add') return Promise.reject(new Error('add failed'))
      if (args[0] === 'read-tree') return Promise.resolve('')
      return Promise.resolve('')
    })

    await expect(createSnapshot(REPO)).rejects.toThrow('add failed')
    // Should have attempted to restore the index
    expect(calls.filter((c) => c[0] === 'read-tree')).toHaveLength(1)
    expect(calls).toContainEqual(['read-tree', 'orig-index'])
  })
})

// ---------------------------------------------------------------------------
// restoreSnapshot
// ---------------------------------------------------------------------------

describe('restoreSnapshot', () => {
  const SNAP_SHA = 'abc123def'

  function setupRestore(opts: { snapFiles?: string[]; tracked?: string[]; untracked?: string[] } = {}) {
    const { snapFiles = ['file.ts'], tracked = ['file.ts'], untracked = [] } = opts
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'cat-file') return Promise.resolve('commit\n')
      if (args[0] === 'ls-tree') return Promise.resolve(snapFiles.join('\n') + '\n')
      if (args[0] === 'ls-files' && args.includes('--others')) return Promise.resolve(untracked.join('\n') + '\n')
      if (args[0] === 'ls-files') return Promise.resolve(tracked.join('\n') + '\n')
      if (args[0] === 'read-tree') return Promise.resolve('')
      if (args[0] === 'checkout') return Promise.resolve('')
      return Promise.resolve('')
    })
  }

  it('verifies the snapshot object exists', async () => {
    setupRestore()
    await restoreSnapshot(REPO, SNAP_SHA)
    expect(mockRaw).toHaveBeenCalledWith(['cat-file', '-t', SNAP_SHA])
  })

  it('throws SNAPSHOT_NOT_FOUND when object is missing', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'cat-file') return Promise.reject(new Error('not found'))
      return Promise.resolve('')
    })
    await expect(restoreSnapshot(REPO, SNAP_SHA)).rejects.toThrow('SNAPSHOT_NOT_FOUND')
  })

  it('calls git checkout to restore files from snapshot', async () => {
    setupRestore()
    await restoreSnapshot(REPO, SNAP_SHA)
    expect(mockRaw).toHaveBeenCalledWith(['checkout', SNAP_SHA, '--', '.'])
  })

  it('syncs the index via read-tree', async () => {
    setupRestore()
    await restoreSnapshot(REPO, SNAP_SHA)
    expect(mockRaw).toHaveBeenCalledWith(['read-tree', SNAP_SHA])
  })

  it('deletes files that are not in the snapshot', async () => {
    setupRestore({
      snapFiles: ['keep.ts'],
      tracked: ['keep.ts', 'remove-me.ts'],
      untracked: ['new-file.ts']
    })
    await restoreSnapshot(REPO, SNAP_SHA)
    // Both tracked and untracked files not in snapshot should be deleted
    expect(mockUnlink).toHaveBeenCalledWith('/repo/remove-me.ts')
    expect(mockUnlink).toHaveBeenCalledWith('/repo/new-file.ts')
    // The kept file should NOT be deleted
    expect(mockUnlink).not.toHaveBeenCalledWith('/repo/keep.ts')
  })

  it('cleans up empty parent directories after deleting files', async () => {
    setupRestore({
      snapFiles: [],
      tracked: ['src/deep/file.ts'],
      untracked: []
    })
    await restoreSnapshot(REPO, SNAP_SHA)
    // Should attempt to remove parent dirs deepest first
    expect(mockRmdir).toHaveBeenCalledWith('/repo/src/deep')
    expect(mockRmdir).toHaveBeenCalledWith('/repo/src')
  })

  it('does not delete files when worktree matches snapshot exactly', async () => {
    setupRestore({
      snapFiles: ['a.ts', 'b.ts'],
      tracked: ['a.ts', 'b.ts'],
      untracked: []
    })
    await restoreSnapshot(REPO, SNAP_SHA)
    expect(mockUnlink).not.toHaveBeenCalled()
  })

  it('throws when not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(restoreSnapshot(REPO, SNAP_SHA)).rejects.toThrow('Not a git repository')
  })

  it('tolerates unlink failures for already-removed files', async () => {
    setupRestore({
      snapFiles: [],
      tracked: ['gone.ts'],
      untracked: []
    })
    mockUnlink.mockRejectedValue(new Error('ENOENT'))
    // Should not throw
    await expect(restoreSnapshot(REPO, SNAP_SHA)).resolves.toBeUndefined()
  })
})
