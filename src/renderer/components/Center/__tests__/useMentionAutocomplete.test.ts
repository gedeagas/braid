import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  reducer,
  initialState,
  MAX_ATTACHED_FILES,
  type MentionState,
} from '../useMentionAutocomplete'
import type { AttachedFile } from '@/types'

// ─── Mocks — must come before dynamic imports ────────────────────────────────

vi.mock('@/lib/ipc', () => ({
  files: { toRelativePaths: vi.fn() },
  git: { getTrackedFiles: vi.fn(), readFile: vi.fn() },
}))
vi.mock('@/store/flash', () => ({ flash: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@/store/sessions/storage', () => ({
  sessionWorktreePaths: new Map([['sess-1', '/repo']]),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFile(path: string): AttachedFile {
  return { path, content: `content of ${path}` }
}

function stateWith(overrides: Partial<MentionState>): MentionState {
  return { ...initialState, ...overrides }
}

// ═══════════════════════════════════════════════════════════════════════
// ADD_FILE — single file attachment
// ═══════════════════════════════════════════════════════════════════════

describe('reducer — ADD_FILE', () => {
  it('appends a new file', () => {
    const state = stateWith({ attachedFiles: [makeFile('a.ts')] })
    const next = reducer(state, { type: 'ADD_FILE', file: makeFile('b.ts') })
    expect(next.attachedFiles).toHaveLength(2)
    expect(next.attachedFiles[1].path).toBe('b.ts')
  })

  it('deduplicates by path', () => {
    const state = stateWith({ attachedFiles: [makeFile('a.ts')] })
    const next = reducer(state, { type: 'ADD_FILE', file: makeFile('a.ts') })
    expect(next.attachedFiles).toHaveLength(1)
  })

  it('rejects when at MAX_ATTACHED_FILES', () => {
    const files = Array.from({ length: MAX_ATTACHED_FILES }, (_, i) => makeFile(`${i}.ts`))
    const state = stateWith({ attachedFiles: files })
    const next = reducer(state, { type: 'ADD_FILE', file: makeFile('extra.ts') })
    expect(next.attachedFiles).toHaveLength(MAX_ATTACHED_FILES)
    expect(next.attachedFiles.find(f => f.path === 'extra.ts')).toBeUndefined()
  })

  it('closes mention autocomplete on add', () => {
    const state = stateWith({ showMention: true, mentionFilter: 'foo' })
    const next = reducer(state, { type: 'ADD_FILE', file: makeFile('a.ts') })
    expect(next.showMention).toBe(false)
    expect(next.mentionFilter).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ADD_FILES — batch file attachment (folder drop)
// ═══════════════════════════════════════════════════════════════════════

describe('reducer — ADD_FILES', () => {
  it('appends multiple files in one dispatch', () => {
    const state = stateWith({ attachedFiles: [makeFile('existing.ts')] })
    const next = reducer(state, {
      type: 'ADD_FILES',
      files: [makeFile('a.ts'), makeFile('b.ts')],
    })
    expect(next.attachedFiles).toHaveLength(3)
    expect(next.attachedFiles.map(f => f.path)).toEqual(['existing.ts', 'a.ts', 'b.ts'])
  })

  it('deduplicates against existing files', () => {
    const state = stateWith({ attachedFiles: [makeFile('a.ts'), makeFile('b.ts')] })
    const next = reducer(state, {
      type: 'ADD_FILES',
      files: [makeFile('b.ts'), makeFile('c.ts')],
    })
    expect(next.attachedFiles).toHaveLength(3)
    expect(next.attachedFiles.map(f => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('does not add when all files are duplicates', () => {
    const state = stateWith({ attachedFiles: [makeFile('a.ts')] })
    const next = reducer(state, { type: 'ADD_FILES', files: [makeFile('a.ts')] })
    expect(next.attachedFiles).toHaveLength(1)
    expect(next.showMention).toBe(false)
  })

  it('caps total attached files at MAX_ATTACHED_FILES', () => {
    const existing = Array.from({ length: MAX_ATTACHED_FILES - 2 }, (_, i) => makeFile(`${i}.ts`))
    const state = stateWith({ attachedFiles: existing })
    const newFiles = [makeFile('new1.ts'), makeFile('new2.ts'), makeFile('new3.ts'), makeFile('new4.ts')]
    const next = reducer(state, { type: 'ADD_FILES', files: newFiles })
    expect(next.attachedFiles).toHaveLength(MAX_ATTACHED_FILES)
    expect(next.attachedFiles.map(f => f.path)).toContain('new1.ts')
    expect(next.attachedFiles.map(f => f.path)).toContain('new2.ts')
    expect(next.attachedFiles.map(f => f.path)).not.toContain('new3.ts')
  })

  it('does not add when already at cap', () => {
    const files = Array.from({ length: MAX_ATTACHED_FILES }, (_, i) => makeFile(`${i}.ts`))
    const state = stateWith({ attachedFiles: files })
    const next = reducer(state, { type: 'ADD_FILES', files: [makeFile('extra.ts')] })
    expect(next.attachedFiles).toHaveLength(MAX_ATTACHED_FILES)
    expect(next.attachedFiles.find(f => f.path === 'extra.ts')).toBeUndefined()
  })

  it('handles empty files array and closes autocomplete', () => {
    const state = stateWith({ showMention: true, mentionFilter: 'foo', attachedFiles: [makeFile('a.ts')] })
    const next = reducer(state, { type: 'ADD_FILES', files: [] })
    expect(next.showMention).toBe(false)
    expect(next.mentionFilter).toBe('')
  })

  it('closes mention autocomplete on add', () => {
    const state = stateWith({ showMention: true, mentionFilter: 'foo' })
    const next = reducer(state, { type: 'ADD_FILES', files: [makeFile('a.ts')] })
    expect(next.showMention).toBe(false)
    expect(next.mentionFilter).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// addFilesByPath — integration tests with mocked IPC
// ═══════════════════════════════════════════════════════════════════════

describe('addFilesByPath', () => {
  let ipc: typeof import('@/lib/ipc')
  let flashMod: typeof import('@/store/flash')
  let renderHook: typeof import('@testing-library/react')['renderHook']
  let act: typeof import('@testing-library/react')['act']
  let useMentionAutocomplete: typeof import('../useMentionAutocomplete')['useMentionAutocomplete']

  beforeEach(async () => {
    vi.clearAllMocks()
    ipc = await import('@/lib/ipc')
    flashMod = await import('@/store/flash')
    const rtl = await import('@testing-library/react')
    renderHook = rtl.renderHook
    act = rtl.act
    const mod = await import('../useMentionAutocomplete')
    useMentionAutocomplete = mod.useMentionAutocomplete
  })

  function setupHook() {
    const session = { id: 'sess-1' } as import('@/types').AgentSession
    let inputVal = ''
    const setInput = (v: string) => { inputVal = v }
    return renderHook(() => useMentionAutocomplete(session, inputVal, setInput))
  }

  it('attaches tracked files from a dropped folder', async () => {
    vi.mocked(ipc.files.toRelativePaths).mockResolvedValue(['src/'])
    vi.mocked(ipc.git.getTrackedFiles).mockResolvedValue(['src/a.ts', 'src/b.ts', 'lib/c.ts'])
    vi.mocked(ipc.git.readFile).mockImplementation(async (p: string) => `content of ${p}`)

    const { result } = setupHook()

    await act(async () => {
      await result.current.addFilesByPath(['/repo/src'])
    })

    expect(result.current.attachedFiles).toHaveLength(2)
    expect(result.current.attachedFiles.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('flashes warning when folder is outside worktree', async () => {
    vi.mocked(ipc.files.toRelativePaths).mockResolvedValue([])

    const { result } = setupHook()

    await act(async () => {
      await result.current.addFilesByPath(['/outside/folder'])
    })

    expect(flashMod.flash).toHaveBeenCalledWith('warning', 'folderOutsideWorktree')
    expect(result.current.attachedFiles).toHaveLength(0)
  })

  it('flashes info when folder has no tracked files', async () => {
    vi.mocked(ipc.files.toRelativePaths).mockResolvedValue(['empty/'])
    vi.mocked(ipc.git.getTrackedFiles).mockResolvedValue(['src/a.ts'])
    vi.mocked(ipc.git.readFile).mockResolvedValue('content')

    const { result } = setupHook()

    await act(async () => {
      await result.current.addFilesByPath(['/repo/empty'])
    })

    expect(flashMod.flash).toHaveBeenCalledWith('info', 'folderNoFiles')
    expect(result.current.attachedFiles).toHaveLength(0)
  })

  it('skips files exceeding MAX_FILE_SIZE', async () => {
    vi.mocked(ipc.files.toRelativePaths).mockResolvedValue(['src/'])
    vi.mocked(ipc.git.getTrackedFiles).mockResolvedValue(['src/big.ts', 'src/small.ts'])
    vi.mocked(ipc.git.readFile).mockImplementation(async (p: string) => {
      if (p.includes('big')) return 'x'.repeat(200_000) // over 100KB
      return 'small content'
    })

    const { result } = setupHook()

    await act(async () => {
      await result.current.addFilesByPath(['/repo/src'])
    })

    expect(result.current.attachedFiles).toHaveLength(1)
    expect(result.current.attachedFiles[0].path).toBe('src/small.ts')
  })

  it('skips unreadable files', async () => {
    vi.mocked(ipc.files.toRelativePaths).mockResolvedValue(['src/'])
    vi.mocked(ipc.git.getTrackedFiles).mockResolvedValue(['src/ok.ts', 'src/broken.ts'])
    vi.mocked(ipc.git.readFile).mockImplementation(async (p: string) => {
      if (p.includes('broken')) throw new Error('read failed')
      return 'ok content'
    })

    const { result } = setupHook()

    await act(async () => {
      await result.current.addFilesByPath(['/repo/src'])
    })

    expect(result.current.attachedFiles).toHaveLength(1)
    expect(result.current.attachedFiles[0].path).toBe('src/ok.ts')
  })
})
