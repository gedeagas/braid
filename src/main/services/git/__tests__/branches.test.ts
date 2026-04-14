import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock simple-git ---
const mockRaw = vi.fn()
const mockBranchLocal = vi.fn()
const mockGit = { raw: mockRaw, branchLocal: mockBranchLocal }

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}))

// --- Mock fs ---
const mockExistsSync = vi.fn()
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return { ...actual, existsSync: (p: string) => mockExistsSync(p) }
})

// --- Mock child_process execFile ---
// branches.ts calls promisify(execFile) at module init (static import). vi.mock factories are
// hoisted BEFORE const declarations, so a plain `const mockExecFile = vi.fn()` causes a TDZ error
// when referenced in the factory. vi.hoisted() co-hoists the initializer alongside vi.mock.
// promisify identity: mockExecFile already returns Promises, so the wrapper is a no-op.
const mockExecFile = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('util', () => ({ promisify: (fn: unknown) => fn }))

// --- Mock resolveNwo (imported from github.ts) ---
const mockResolveNwo = vi.hoisted(() => vi.fn())
vi.mock('../../github', () => ({ resolveNwo: mockResolveNwo }))

import { renameBranch, isBranchProtected, getTrackingBranch } from '../branches'

const REPO = '/repo'

beforeEach(() => {
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(true)
  mockRaw.mockResolvedValue('')
  mockBranchLocal.mockResolvedValue({ all: [] })
})

// ---------------------------------------------------------------------------
describe('renameBranch', () => {
  it('calls git branch -m with old and new names', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feat/old'] })

    await renameBranch(REPO, 'feat/old', 'feat/new')

    expect(mockRaw).toHaveBeenCalledWith(['branch', '-m', 'feat/old', 'feat/new'])
  })

  it('throws when new name already exists locally', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feat/existing'] })

    await expect(renameBranch(REPO, 'feat/old', 'feat/existing'))
      .rejects.toThrow("A branch named 'feat/existing' already exists")
  })

  it('throws when path is not a valid git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(renameBranch(REPO, 'old', 'new')).rejects.toThrow('Not a git repository')
  })

  it('does not throw when new name is genuinely new', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main'] })
    await expect(renameBranch(REPO, 'main', 'trunk')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
describe('isBranchProtected', () => {
  it('returns true when gh api reports protected=true', async () => {
    mockResolveNwo.mockResolvedValueOnce('org/repo')
    mockExecFile.mockResolvedValueOnce({ stdout: 'true\n', stderr: '' })

    const result = await isBranchProtected(REPO, 'main')
    expect(result).toBe(true)
  })

  it('returns false when gh api reports protected=false', async () => {
    mockResolveNwo.mockResolvedValueOnce('org/repo')
    mockExecFile.mockResolvedValueOnce({ stdout: 'false\n', stderr: '' })

    const result = await isBranchProtected(REPO, 'feat/branch')
    expect(result).toBe(false)
  })

  it('returns false when gh is not available (resolveNwo throws)', async () => {
    mockResolveNwo.mockRejectedValue(new Error('gh: command not found'))

    const result = await isBranchProtected(REPO, 'main')
    expect(result).toBe(false)
  })

  it('returns false when resolveNwo throws (no repo)', async () => {
    mockResolveNwo.mockRejectedValueOnce(new Error('Could not resolve repo nameWithOwner'))

    const result = await isBranchProtected(REPO, 'main')
    expect(result).toBe(false)
  })

  it('URL-encodes the branch name in the API path', async () => {
    mockResolveNwo.mockResolvedValueOnce('org/repo')
    mockExecFile.mockResolvedValueOnce({ stdout: 'false\n', stderr: '' })

    await isBranchProtected(REPO, 'feat/my branch')

    const apiCall = mockExecFile.mock.calls[0]
    const apiArgs: string[] = apiCall[1]
    expect(apiArgs.some((a) => a.includes('feat%2Fmy%20branch'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('getTrackingBranch', () => {
  it('returns trimmed upstream branch name', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return Promise.resolve('.git')
      if (args[0] === 'rev-parse' && args[2]?.includes('@{upstream}')) {
        return Promise.resolve('origin/main\n')
      }
      return Promise.resolve('')
    })

    const result = await getTrackingBranch(REPO, 'main')
    expect(result).toBe('origin/main')
  })

  it('returns null when no upstream is configured', async () => {
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return Promise.resolve('.git')
      throw new Error('no upstream configured')
    })

    const result = await getTrackingBranch(REPO, 'feat/local-only')
    expect(result).toBeNull()
  })

  it('returns null when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)
    const result = await getTrackingBranch(REPO, 'main')
    expect(result).toBeNull()
  })
})
