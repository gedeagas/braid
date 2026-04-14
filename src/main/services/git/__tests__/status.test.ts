import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock simple-git ---
const mockRaw = vi.fn()
const mockDiff = vi.fn()
const mockStatus = vi.fn()
const mockGit = { raw: mockRaw, diff: mockDiff, status: mockStatus }

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}))

// --- Mock fs ---
const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockReaddirSync = vi.fn()
const mockStatSync = vi.fn()

vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return {
    ...actual,
    existsSync: (p: string) => mockExistsSync(p),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    statSync: (...args: unknown[]) => mockStatSync(...args),
  }
})

// Import AFTER mocks are in place
import { getFileDiff, getStatus } from '../status'

const REPO = '/repo'

beforeEach(() => {
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(true)
  // Default: rev-parse succeeds → valid git repo
  mockRaw.mockResolvedValue('.git')
  mockDiff.mockResolvedValue('')
  mockStatus.mockResolvedValue({ files: [] })
})

// ---------------------------------------------------------------------------
describe('getFileDiff', () => {
  describe('untracked file (status=?)', () => {
    it('produces correct line count for a newline-terminated file', async () => {
      // split('\n') on "line1\nline2\n" → ['line1', 'line2', '']
      // trailing '' must be dropped → 2 lines, not 3
      mockReadFileSync.mockReturnValue('line1\nline2\n')

      const diff = await getFileDiff(REPO, 'src/new.ts', '?', false)

      expect(diff).toContain('@@ -0,0 +1,2 @@')
      expect(diff).not.toContain('+1,3')
    })

    it('produces correct line count for a file without trailing newline', async () => {
      // split('\n') on "line1\nline2" → ['line1', 'line2'] — no trailing '' → 2 lines
      mockReadFileSync.mockReturnValue('line1\nline2')

      const diff = await getFileDiff(REPO, 'src/new.ts', '?', false)

      expect(diff).toContain('@@ -0,0 +1,2 @@')
    })

    it('handles a single-line file with trailing newline', async () => {
      mockReadFileSync.mockReturnValue('hello\n')

      const diff = await getFileDiff(REPO, 'src/new.ts', '?', false)

      expect(diff).toContain('@@ -0,0 +1,1 @@')
      expect(diff).toContain('+hello')
    })

    it('prefixes every content line with +', async () => {
      mockReadFileSync.mockReturnValue('alpha\nbeta\n')

      const diff = await getFileDiff(REPO, 'src/new.ts', '?', false)

      expect(diff).toContain('+alpha')
      expect(diff).toContain('+beta')
    })

    it('includes standard unified diff header', async () => {
      mockReadFileSync.mockReturnValue('x\n')

      const diff = await getFileDiff(REPO, 'src/new.ts', '?', false)

      expect(diff).toContain('--- /dev/null')
      expect(diff).toContain('+++ b/src/new.ts')
    })

    it('reads the file from the correct absolute path', async () => {
      mockReadFileSync.mockReturnValue('content\n')

      await getFileDiff(REPO, 'src/new.ts', '?', false)

      expect(mockReadFileSync).toHaveBeenCalledWith('/repo/src/new.ts', 'utf-8')
    })
  })

  describe('staged file', () => {
    it('calls git diff --cached for staged modified files', async () => {
      mockDiff.mockResolvedValue('staged diff content')

      const result = await getFileDiff(REPO, 'src/a.ts', 'M', true)

      expect(mockDiff).toHaveBeenCalledWith(['--cached', '--', 'src/a.ts'])
      expect(result).toBe('staged diff content')
    })
  })

  describe('deleted file (status=D, unstaged)', () => {
    it('diffs against HEAD for deleted files', async () => {
      mockDiff.mockResolvedValue('deleted diff')

      const result = await getFileDiff(REPO, 'src/gone.ts', 'D', false)

      expect(mockDiff).toHaveBeenCalledWith(['HEAD', '--', 'src/gone.ts'])
      expect(result).toBe('deleted diff')
    })
  })

  describe('modified file (unstaged)', () => {
    it('calls git diff without HEAD for unstaged modifications', async () => {
      mockDiff.mockResolvedValue('unstaged diff')

      const result = await getFileDiff(REPO, 'src/a.ts', 'M', false)

      expect(mockDiff).toHaveBeenCalledWith(['--', 'src/a.ts'])
      expect(result).toBe('unstaged diff')
    })
  })

  it('returns empty string when path is not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)

    const result = await getFileDiff(REPO, 'src/a.ts', 'M', false)

    expect(result).toBe('')
  })

  it('returns empty string when git diff throws', async () => {
    mockDiff.mockRejectedValue(new Error('fatal: bad object'))

    const result = await getFileDiff(REPO, 'src/a.ts', 'M', false)

    expect(result).toBe('')
  })
})

// ---------------------------------------------------------------------------
describe('getStatus', () => {
  it('returns empty array when not a git repo', async () => {
    mockExistsSync.mockReturnValue(false)

    const result = await getStatus(REPO)

    expect(result).toEqual([])
  })

  it('maps staged modified file correctly', async () => {
    mockStatus.mockResolvedValue({
      files: [{ path: 'src/a.ts', index: 'M', working_dir: ' ' }],
    })

    const result = await getStatus(REPO)

    expect(result).toContainEqual({ file: 'src/a.ts', status: 'M', staged: true })
  })

  it('maps staged added file correctly', async () => {
    mockStatus.mockResolvedValue({
      files: [{ path: 'src/new.ts', index: 'A', working_dir: ' ' }],
    })

    const result = await getStatus(REPO)

    expect(result).toContainEqual({ file: 'src/new.ts', status: 'A', staged: true })
  })

  it('maps unstaged modified file correctly', async () => {
    mockStatus.mockResolvedValue({
      files: [{ path: 'src/a.ts', index: ' ', working_dir: 'M' }],
    })

    const result = await getStatus(REPO)

    expect(result).toContainEqual({ file: 'src/a.ts', status: 'M', staged: false })
  })

  it('maps untracked file correctly', async () => {
    mockStatus.mockResolvedValue({
      files: [{ path: 'src/new.ts', index: '?', working_dir: '?' }],
    })

    const result = await getStatus(REPO)

    expect(result).toContainEqual({ file: 'src/new.ts', status: '?', staged: false })
  })

  it('emits both staged and unstaged entries for a file with changes in both areas', async () => {
    mockStatus.mockResolvedValue({
      files: [{ path: 'src/a.ts', index: 'M', working_dir: 'M' }],
    })

    const result = await getStatus(REPO)

    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ file: 'src/a.ts', status: 'M', staged: true })
    expect(result).toContainEqual({ file: 'src/a.ts', status: 'M', staged: false })
  })
})
