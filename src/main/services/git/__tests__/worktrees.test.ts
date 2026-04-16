import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock simple-git ---
const mockRaw = vi.fn()
const mockBranchLocal = vi.fn()
const mockClone = vi.fn()
const mockGit = { raw: mockRaw, branchLocal: mockBranchLocal, clone: mockClone }

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}))

// --- Mock fs ---
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockRmSync = vi.fn()

vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return {
    ...actual,
    existsSync: (p: string) => mockExistsSync(p),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
  }
})

// --- Mock appBrand ---
vi.mock('../../appBrand', () => ({ DATA_DIR_NAME: 'Braid' }))

// Import AFTER mocks are in place
import { getWorktrees, addWorktree, removeWorktree, cloneRepo, parseRepoName, CloneError } from '../worktrees'

// Stable repo path for tests
const REPO = '/repo'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: path exists and rev-parse succeeds → valid git repo
  mockExistsSync.mockReturnValue(true)
  mockRaw.mockResolvedValue('')
})

// ---------------------------------------------------------------------------
describe('getWorktrees', () => {
  it('parses main + linked worktree from porcelain output', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse') return Promise.resolve('.git')
      if (args[0] === 'worktree') {
        return Promise.resolve(
          'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n' +
          'worktree /repo/wt/feat\nHEAD def456\nbranch refs/heads/feat/my-feature\n\n'
        )
      }
      return Promise.resolve('')
    })

    const result = await getWorktrees(REPO)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ path: '/repo', branch: 'main', isMain: true })
    expect(result[1]).toEqual({ path: '/repo/wt/feat', branch: 'feat/my-feature', isMain: false })
  })

  it('returns [] when path does not exist', async () => {
    mockExistsSync.mockReturnValue(false)
    const result = await getWorktrees(REPO)
    expect(result).toEqual([])
  })

  it('returns [] when path is not a git repo', async () => {
    mockRaw.mockRejectedValue(new Error('not a repo'))
    const result = await getWorktrees(REPO)
    expect(result).toEqual([])
  })

  it('uses HEAD as branch when branch line is missing', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse') return Promise.resolve('.git')
      if (args[0] === 'worktree') {
        // Detached HEAD — no branch line
        return Promise.resolve('worktree /repo\nHEAD abc123\n\n')
      }
      return Promise.resolve('')
    })

    const result = await getWorktrees(REPO)
    expect(result[0].branch).toBe('HEAD')
  })

  it('includes the last worktree when output has no trailing newline', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse') return Promise.resolve('.git')
      if (args[0] === 'worktree') {
        // No trailing \n after the last stanza — simulates git output without trailing newline
        return Promise.resolve(
          'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n' +
          'worktree /repo/wt/feat\nHEAD def456\nbranch refs/heads/feat'
        )
      }
      return Promise.resolve('')
    })

    const result = await getWorktrees(REPO)

    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({ path: '/repo/wt/feat', branch: 'feat', isMain: false })
  })
})

// ---------------------------------------------------------------------------
describe('addWorktree', () => {
  beforeEach(() => {
    mockBranchLocal.mockResolvedValue({ all: [] })
    mockMkdirSync.mockReturnValue(undefined)
  })

  it('creates new branch from HEAD when no baseBranch provided', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      // repo exists, target path does not exist yet
      if (p === REPO) return true
      return false
    })

    await addWorktree(REPO, 'feat/new', 'myproject')

    expect(mockRaw).toHaveBeenCalledWith(
      expect.arrayContaining(['worktree', 'add', '-b', 'feat/new'])
    )
  })

  it('creates new branch from baseBranch when provided', async () => {
    mockExistsSync.mockImplementation((p: string) => p === REPO)

    await addWorktree(REPO, 'feat/new', 'myproject', 'origin/main')

    expect(mockRaw).toHaveBeenCalledWith(
      expect.arrayContaining(['worktree', 'add', '-b', 'feat/new', expect.any(String), 'origin/main'])
    )
  })

  it('checks out existing branch without -b flag', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['feat/existing'] })
    mockExistsSync.mockImplementation((p: string) => p === REPO)

    await addWorktree(REPO, 'feat/existing', 'myproject')

    const rawCalls = mockRaw.mock.calls.map((c) => c[0])
    const worktreeCall = rawCalls.find((args) => args[0] === 'worktree')
    expect(worktreeCall).toBeDefined()
    expect(worktreeCall).not.toContain('-b')
    expect(worktreeCall).toContain('feat/existing')
  })

  it('appends -2 suffix when target path already exists', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      // REPO exists, and the first target path exists, but -2 does not
      if (p === REPO) return true
      if (p.endsWith('-2')) return false
      if (p.includes('feat-new')) return true
      return false
    })

    await addWorktree(REPO, 'feat/new', 'myproject')

    const rawCalls = mockRaw.mock.calls.map((c) => c[0])
    const worktreeCall = rawCalls.find((args: string[]) => args[0] === 'worktree')
    expect(worktreeCall).toBeDefined()
    // Final path should end with -2
    const finalPath = worktreeCall!.find((arg: string) => arg.endsWith('-2'))
    expect(finalPath).toBeDefined()
  })

  it('sanitizes branch name with slashes to use dashes in path', async () => {
    mockExistsSync.mockImplementation((p: string) => p === REPO)

    await addWorktree(REPO, 'feat/my-feature', 'myproject')

    const rawCalls = mockRaw.mock.calls.map((c) => c[0])
    const worktreeCall = rawCalls.find((args: string[]) => args[0] === 'worktree')
    // The path arg should not contain '/' from the branch name
    const pathArg = worktreeCall!.find((arg: string) => arg.includes('feat-my-feature'))
    expect(pathArg).toBeDefined()
  })

  it('throws when path is not a valid git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(addWorktree(REPO, 'feat', 'proj')).rejects.toThrow('Not a git repository')
  })

  it('re-throws git errors without swallowing them', async () => {
    mockExistsSync.mockImplementation((p: string) => p === REPO)
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse') return Promise.resolve('.git')
      throw new Error('fatal: branch already checked out')
    })

    await expect(addWorktree(REPO, 'feat', 'proj')).rejects.toThrow('fatal: branch already checked out')
  })
})

// ---------------------------------------------------------------------------
describe('removeWorktree', () => {
  it('calls git worktree remove --force', async () => {
    await removeWorktree(REPO, '/repo/wt/feat')

    expect(mockRaw).toHaveBeenCalledWith(['worktree', 'remove', '/repo/wt/feat', '--force'])
  })

  it('throws when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(removeWorktree(REPO, '/repo/wt/feat')).rejects.toThrow('Not a git repository')
  })

  it('propagates git errors (does not swallow)', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse') return Promise.resolve('.git')
      throw new Error('fatal: worktree is dirty')
    })

    await expect(removeWorktree(REPO, '/repo/wt/feat')).rejects.toThrow('fatal: worktree is dirty')
  })
})

// ---------------------------------------------------------------------------
describe('parseRepoName', () => {
  it('extracts name from HTTPS URL', () => {
    expect(parseRepoName('https://github.com/owner/my-app')).toBe('my-app')
  })

  it('strips .git suffix from HTTPS URL', () => {
    expect(parseRepoName('https://github.com/owner/my-app.git')).toBe('my-app')
  })

  it('extracts name from SSH URL', () => {
    expect(parseRepoName('git@github.com:owner/my-app.git')).toBe('my-app')
  })

  it('handles SSH URL without .git suffix', () => {
    expect(parseRepoName('git@github.com:owner/my-app')).toBe('my-app')
  })

  it('strips trailing slashes', () => {
    expect(parseRepoName('https://github.com/owner/my-app/')).toBe('my-app')
    expect(parseRepoName('https://github.com/owner/my-app///')).toBe('my-app')
  })

  it('handles URL with extra path segments', () => {
    expect(parseRepoName('https://github.com/owner/my-app/tree/main/src')).toBe('src')
  })

  it('returns "repo" for empty string', () => {
    expect(parseRepoName('')).toBe('repo')
  })

  it('returns "repo" for whitespace-only input', () => {
    expect(parseRepoName('   ')).toBe('repo')
  })

  it('handles SSH URL with single segment after colon', () => {
    expect(parseRepoName('git@github.com:repo.git')).toBe('repo')
  })
})

// ---------------------------------------------------------------------------
describe('cloneRepo', () => {
  beforeEach(() => {
    mockMkdirSync.mockReturnValue(undefined)
  })

  it('clones to ~/Braid/repos/{repoName}/', async () => {
    mockExistsSync.mockReturnValue(false)
    mockClone.mockResolvedValue('')

    const result = await cloneRepo('https://github.com/owner/my-app.git')

    expect(mockClone).toHaveBeenCalledWith(
      'https://github.com/owner/my-app.git',
      expect.stringContaining('my-app')
    )
    expect(result).toContain('my-app')
  })

  it('uses custom storagePath when provided', async () => {
    mockExistsSync.mockReturnValue(false)
    mockClone.mockResolvedValue('')

    const result = await cloneRepo('https://github.com/owner/repo.git', '/custom/path')

    expect(result).toMatch(/^\/custom\/path\/repo/)
  })

  it('appends -2 suffix when target path exists', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.endsWith('-2'))
    mockClone.mockResolvedValue('')

    const result = await cloneRepo('https://github.com/owner/repo.git')

    expect(result).toMatch(/-2$/)
  })

  it('handles SSH URLs correctly', async () => {
    mockExistsSync.mockReturnValue(false)
    mockClone.mockResolvedValue('')

    const result = await cloneRepo('git@github.com:owner/my-lib.git')

    expect(result).toContain('my-lib')
    expect(result).not.toContain(':')
    expect(result).not.toContain('owner')
  })

  it('throws CloneError with "auth" code on authentication failure', async () => {
    mockExistsSync.mockReturnValue(false)
    mockClone.mockRejectedValue(new Error('Permission denied (publickey). Could not read from remote repository.'))

    await expect(cloneRepo('git@github.com:owner/repo.git')).rejects.toThrow(CloneError)
    try {
      await cloneRepo('git@github.com:owner/repo.git')
    } catch (err) {
      expect((err as CloneError).code).toBe('auth')
    }
  })

  it('throws CloneError with "not_found" code when repo does not exist', async () => {
    mockExistsSync.mockReturnValue(false)
    mockClone.mockRejectedValue(new Error('repository not found'))

    try {
      await cloneRepo('https://github.com/owner/nonexistent.git')
    } catch (err) {
      expect(err).toBeInstanceOf(CloneError)
      expect((err as CloneError).code).toBe('not_found')
    }
  })

  it('throws CloneError with "network" code on connection failure', async () => {
    mockExistsSync.mockReturnValue(false)
    mockClone.mockRejectedValue(new Error('Could not resolve host: github.com'))

    try {
      await cloneRepo('https://github.com/owner/repo.git')
    } catch (err) {
      expect(err).toBeInstanceOf(CloneError)
      expect((err as CloneError).code).toBe('network')
    }
  })

  it('cleans up partial directory on clone failure', async () => {
    mockExistsSync.mockReturnValue(false)
    mockClone.mockRejectedValue(new Error('repository not found'))

    await expect(cloneRepo('https://github.com/owner/repo.git')).rejects.toThrow()

    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining('repo'),
      { recursive: true, force: true }
    )
  })
})
