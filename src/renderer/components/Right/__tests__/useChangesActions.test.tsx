import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReducer } from 'react'
import type { GitChange } from '@/types'
import { changesReducer, initialState } from '../changesState'
import { useChangesActions } from '../useChangesActions'

const setChangesCount = vi.fn()
const bumpDiffRevision = vi.fn()

vi.mock('@/lib/ipc', () => ({
  cleanIpcError: vi.fn((_err: unknown, fallback: string) => fallback),
  git: {
    getStatus: vi.fn(),
    getGitSyncStatus: vi.fn(),
  },
}))

vi.mock('@/store/ui', () => ({
  useUIStore: {
    getState: () => ({
      setChangesCount,
      bumpDiffRevision,
    }),
  },
}))

vi.mock('@/store/prCache', () => ({
  usePrCacheStore: {
    getState: () => ({ cache: {} }),
  },
}))

vi.mock('@/store/flash', () => ({ flash: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const worktreePath = '/repo'

function setup() {
  return renderHook(() => {
    const [state, dispatch] = useReducer(changesReducer, initialState)
    const actions = useChangesActions(worktreePath, state, dispatch)
    return { state, actions }
  })
}

describe('useChangesActions', () => {
  let ipc: typeof import('@/lib/ipc')

  beforeEach(async () => {
    vi.clearAllMocks()
    ipc = await import('@/lib/ipc')
  })

  it('does not bump diff revision when status refresh is unchanged', async () => {
    const status: GitChange[] = [
      { file: 'src/a.ts', status: 'M', staged: false, additions: 2, deletions: 1 },
    ]
    vi.mocked(ipc.git.getStatus).mockResolvedValue(status)
    const { result } = setup()

    await act(async () => {
      await result.current.actions.loadStatus()
    })
    await act(async () => {
      await result.current.actions.loadStatus()
    })

    expect(ipc.git.getStatus).toHaveBeenCalledTimes(2)
    expect(setChangesCount).toHaveBeenCalledTimes(1)
    expect(bumpDiffRevision).toHaveBeenCalledTimes(1)
    expect(result.current.state.changes).toEqual(status)
  })

  it('bumps diff revision when status content changes', async () => {
    const firstStatus: GitChange[] = [
      { file: 'src/a.ts', status: 'M', staged: false, additions: 2, deletions: 1 },
    ]
    const nextStatus: GitChange[] = [
      { file: 'src/a.ts', status: 'M', staged: true, additions: 2, deletions: 1 },
    ]
    vi.mocked(ipc.git.getStatus)
      .mockResolvedValueOnce(firstStatus)
      .mockResolvedValueOnce(nextStatus)
    const { result } = setup()

    await act(async () => {
      await result.current.actions.loadStatus()
    })
    await act(async () => {
      await result.current.actions.loadStatus()
    })

    expect(setChangesCount).toHaveBeenCalledTimes(2)
    expect(bumpDiffRevision).toHaveBeenCalledTimes(2)
    expect(result.current.state.changes).toEqual(nextStatus)
  })

  it('does not apply a status result after unmount', async () => {
    const status: GitChange[] = [
      { file: 'src/a.ts', status: 'M', staged: false, additions: 2, deletions: 1 },
    ]
    let resolveStatus!: (value: GitChange[]) => void
    vi.mocked(ipc.git.getStatus).mockImplementationOnce(() =>
      new Promise((resolve) => { resolveStatus = resolve })
    )
    const { result, unmount } = setup()

    let loadPromise!: Promise<void>
    act(() => {
      loadPromise = result.current.actions.loadStatus()
    })
    unmount()

    await act(async () => {
      resolveStatus(status)
      await loadPromise
    })

    expect(setChangesCount).not.toHaveBeenCalled()
    expect(bumpDiffRevision).not.toHaveBeenCalled()
  })
})
