import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock simple-git ---
const mockRaw = vi.fn()
const mockPush = vi.fn()
const mockPull = vi.fn()
const mockAdd = vi.fn()
const mockReset = vi.fn()
const mockCheckout = vi.fn()
const mockCommit = vi.fn()
const mockGit = { raw: mockRaw, push: mockPush, pull: mockPull, add: mockAdd, reset: mockReset, checkout: mockCheckout, commit: mockCommit }

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}))

// --- Mock fs ---
const mockExistsSync = vi.fn()
const mockUnlinkSync = vi.fn()
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return {
    ...actual,
    existsSync: (p: string) => mockExistsSync(p),
    unlinkSync: (p: string) => mockUnlinkSync(p),
  }
})

import { push, pull, stageFiles, unstageFiles, discardChanges, commit } from '../operations'

const REPO = '/repo'

beforeEach(() => {
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(true)
  mockRaw.mockResolvedValue('')
  mockPush.mockResolvedValue(undefined)
  mockPull.mockResolvedValue({ files: [] })
  mockAdd.mockResolvedValue(undefined)
  mockReset.mockResolvedValue(undefined)
  mockCheckout.mockResolvedValue(undefined)
  mockCommit.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
describe('push', () => {
  it('pushes normally when upstream is already set', async () => {
    // upstream tracking exists
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return Promise.resolve('.git')
      if (args.includes('@{u}')) return Promise.resolve('origin/main\n')
      return Promise.resolve('')
    })

    await push(REPO)

    expect(mockPush).toHaveBeenCalledWith()  // no extra args
    expect(mockPush).not.toHaveBeenCalledWith(['-u', 'origin', 'HEAD'])
  })

  it('pushes with -u origin HEAD when no upstream is set', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return Promise.resolve('.git')
      if (args.includes('@{u}')) throw new Error('no upstream configured')
      return Promise.resolve('')
    })

    await push(REPO)

    expect(mockPush).toHaveBeenCalledWith(['-u', 'origin', 'HEAD'])
  })

  it('throws when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(push(REPO)).rejects.toThrow('Not a git repository')
  })
})

// ---------------------------------------------------------------------------
describe('pull', () => {
  it('pulls with --rebase when strategy is rebase', async () => {
    mockPull.mockResolvedValue({ files: ['src/foo.ts'] })

    const result = await pull(REPO, 'rebase')

    expect(mockPull).toHaveBeenCalledWith(['--rebase'])
    expect(result.alreadyUpToDate).toBe(false)
  })

  it('pulls with --no-rebase when strategy is merge', async () => {
    mockPull.mockResolvedValue({ files: [] })

    const result = await pull(REPO, 'merge')

    expect(mockPull).toHaveBeenCalledWith(['--no-rebase'])
    expect(result.alreadyUpToDate).toBe(true)
  })

  it('pulls without strategy flags when no strategy provided', async () => {
    mockPull.mockResolvedValue({ files: [] })

    await pull(REPO)

    expect(mockPull).toHaveBeenCalledWith()  // no opts
  })

  it('returns alreadyUpToDate=true when no files changed', async () => {
    mockPull.mockResolvedValue({ files: [] })

    const result = await pull(REPO)
    expect(result.alreadyUpToDate).toBe(true)
  })

  it('throws DIVERGENT_BRANCHES sentinel on diverged error', async () => {
    mockPull.mockRejectedValue(new Error('fatal: Need to specify how to reconcile divergent branches'))

    await expect(pull(REPO)).rejects.toThrow('DIVERGENT_BRANCHES')
  })

  it('throws DIVERGENT_BRANCHES on "divergent branches" message', async () => {
    mockPull.mockRejectedValue(new Error('divergent branches'))

    await expect(pull(REPO)).rejects.toThrow('DIVERGENT_BRANCHES')
  })

  it('throws clean message when no upstream is configured', async () => {
    mockPull.mockRejectedValue(new Error('There is no tracking information for the current branch.\nhas no upstream branch'))

    await expect(pull(REPO)).rejects.toThrow('No upstream branch configured')
  })

  it('throws clean first-line error for other git failures', async () => {
    mockPull.mockRejectedValue(new Error('error: Your local changes would be overwritten by merge'))

    await expect(pull(REPO)).rejects.toThrow('Your local changes would be overwritten by merge')
  })

  it('throws when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(pull(REPO)).rejects.toThrow('Not a git repository')
  })
})

// ---------------------------------------------------------------------------
describe('stageFiles', () => {
  it('calls git.add with the provided files', async () => {
    await stageFiles(REPO, ['src/a.ts', 'src/b.ts'])
    expect(mockAdd).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts'])
  })

  it('throws when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(stageFiles(REPO, ['file.ts'])).rejects.toThrow('Not a git repository')
  })
})

// ---------------------------------------------------------------------------
describe('unstageFiles', () => {
  it('calls git.reset with -- prefix and the provided files', async () => {
    await unstageFiles(REPO, ['src/a.ts'])
    expect(mockReset).toHaveBeenCalledWith(['--', 'src/a.ts'])
  })

  it('falls back to git rm --cached when reset fails with "Failed to resolve" (initial commit)', async () => {
    mockReset.mockRejectedValue(new Error("Failed to resolve 'HEAD' as a valid ref"))

    await unstageFiles(REPO, ['src/a.ts', 'src/b.ts'])

    expect(mockRaw).toHaveBeenCalledWith(['rm', '--cached', '--', 'src/a.ts', 'src/b.ts'])
  })

  it('falls back to git rm --cached when reset fails with "unknown revision" (initial commit)', async () => {
    mockReset.mockRejectedValue(new Error('unknown revision or path not in the working tree'))

    await unstageFiles(REPO, ['src/new.ts'])

    expect(mockRaw).toHaveBeenCalledWith(['rm', '--cached', '--', 'src/new.ts'])
  })

  it('re-throws reset errors that are not initial-commit related', async () => {
    mockReset.mockRejectedValue(new Error('fatal: permission denied'))

    await expect(unstageFiles(REPO, ['src/a.ts'])).rejects.toThrow('fatal: permission denied')
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['rm', '--cached']))
  })

  it('throws when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(unstageFiles(REPO, ['file.ts'])).rejects.toThrow('Not a git repository')
  })
})

// ---------------------------------------------------------------------------
describe('discardChanges', () => {
  it('deletes the file via unlinkSync for untracked files (status=?)', async () => {
    await discardChanges(REPO, 'src/new.ts', '?')
    expect(mockUnlinkSync).toHaveBeenCalledWith('/repo/src/new.ts')
    expect(mockCheckout).not.toHaveBeenCalled()
  })

  it('calls git checkout -- for tracked modified files (status=M)', async () => {
    await discardChanges(REPO, 'src/existing.ts', 'M')
    expect(mockCheckout).toHaveBeenCalledWith(['--', 'src/existing.ts'])
    expect(mockUnlinkSync).not.toHaveBeenCalled()
  })

  it('calls git checkout -- for tracked deleted files (status=D)', async () => {
    await discardChanges(REPO, 'src/deleted.ts', 'D')
    expect(mockCheckout).toHaveBeenCalledWith(['--', 'src/deleted.ts'])
  })

  it('throws when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(discardChanges(REPO, 'file.ts', 'M')).rejects.toThrow('Not a git repository')
  })

  // --- Staged discard ---
  it('calls git checkout HEAD -- for staged modified files (status=M, staged=true)', async () => {
    await discardChanges(REPO, 'src/existing.ts', 'M', true)
    expect(mockCheckout).toHaveBeenCalledWith(['HEAD', '--', 'src/existing.ts'])
  })

  it('calls git checkout HEAD -- for staged deleted files (status=D, staged=true)', async () => {
    await discardChanges(REPO, 'src/deleted.ts', 'D', true)
    expect(mockCheckout).toHaveBeenCalledWith(['HEAD', '--', 'src/deleted.ts'])
  })

  it('calls git rm -f for staged new files (status=A, staged=true)', async () => {
    await discardChanges(REPO, 'src/new.ts', 'A', true)
    expect(mockRaw).toHaveBeenCalledWith(['rm', '-f', '--', 'src/new.ts'])
    expect(mockCheckout).not.toHaveBeenCalled()
    expect(mockUnlinkSync).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe('commit', () => {
  it('calls git.commit with the provided message', async () => {
    await commit(REPO, 'feat: add widget')
    expect(mockCommit).toHaveBeenCalledWith('feat: add widget')
  })

  it('throws when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(commit(REPO, 'msg')).rejects.toThrow('Not a git repository')
  })
})
