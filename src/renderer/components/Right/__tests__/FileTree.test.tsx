import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '../FileTree'
import type { WorktreeRefreshEvent } from '@/lib/worktreeRefresh'

const getFileTree = vi.fn()
let refreshHandler: ((event: WorktreeRefreshEvent) => void | Promise<void>) | null = null
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

vi.mock('@/lib/ipc', () => ({
  git: {
    getFileTree: (...args: unknown[]) => getFileTree(...args),
  },
  shell: {
    platform: 'darwin',
    getInstalledApps: vi.fn().mockResolvedValue([]),
    openInApp: vi.fn(),
  },
}))

vi.mock('@/lib/worktreeRefresh', () => ({
  requestWorktreeRefresh: vi.fn((worktreePath: string, resource: string, options: { reason: string; force: boolean }) => {
    refreshHandler?.({
      worktreePath,
      topic: resource,
      resource,
      topics: [resource],
      resources: [resource],
      resourceKey: `worktree:${worktreePath}:${resource}`,
      resourceKeys: [`worktree:${worktreePath}:${resource}`],
      reason: options.reason,
      force: options.force,
      requestedAt: Date.now(),
    } as WorktreeRefreshEvent)
  }),
  subscribeWorktreeRefresh: vi.fn((_worktreePath: string, _resource: string, handler: typeof refreshHandler) => {
    refreshHandler = handler
    return () => {
      refreshHandler = null
    }
  }),
}))

vi.mock('@/store/ui', () => ({
  useUIStore: {
    getState: () => ({ openQuickOpen: vi.fn() }),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('FileTree', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    refreshHandler = null
    getFileTree.mockImplementation((path: string) => {
      if (path === '/repo') return Promise.resolve([{ name: 'src', path: 'src', isDirectory: true }])
      if (path === '/repo/src') return Promise.resolve([{ name: 'index.ts', path: 'index.ts', isDirectory: false }])
      return Promise.resolve([])
    })
  })

  it('preserves expanded folders when refreshing', async () => {
    render(<FileTree worktreePath="/repo" onFileSelect={vi.fn()} />)

    fireEvent.click(await screen.findByText('src'))
    await screen.findByText('index.ts')

    getFileTree.mockImplementation((path: string) => {
      if (path === '/repo') return Promise.resolve([{ name: 'src', path: 'src', isDirectory: true }])
      if (path === '/repo/src') return Promise.resolve([
        { name: 'index.ts', path: 'index.ts', isDirectory: false },
        { name: 'util.ts', path: 'util.ts', isDirectory: false },
      ])
      return Promise.resolve([])
    })

    fireEvent.click(screen.getByText('refresh'))

    await screen.findByText('util.ts')
    expect(screen.getByText('index.ts')).toBeTruthy()
    await waitFor(() => {
      expect(getFileTree).toHaveBeenCalledWith('/repo/src', true)
    })
  })

  it('ignores stale root loads after switching worktrees', async () => {
    const slowRepo = deferred<Array<{ name: string; path: string; isDirectory: boolean }>>()
    getFileTree.mockImplementation((path: string) => {
      if (path === '/repo-a') return slowRepo.promise
      if (path === '/repo-b') return Promise.resolve([{ name: 'current.ts', path: 'current.ts', isDirectory: false }])
      return Promise.resolve([])
    })

    const { rerender } = render(<FileTree worktreePath="/repo-a" onFileSelect={vi.fn()} />)
    rerender(<FileTree worktreePath="/repo-b" onFileSelect={vi.fn()} />)

    await screen.findByText('current.ts')
    slowRepo.resolve([{ name: 'stale.ts', path: 'stale.ts', isDirectory: false }])

    await waitFor(() => {
      expect(screen.queryByText('stale.ts')).toBeNull()
    })
  })

  it('ignores stale directory loads after switching away and back to the same worktree', async () => {
    const slowDirectory = deferred<Array<{ name: string; path: string; isDirectory: boolean }>>()
    let srcLoadCount = 0
    getFileTree.mockImplementation((path: string) => {
      if (path === '/repo-a') return Promise.resolve([{ name: 'src', path: 'src', isDirectory: true }])
      if (path === '/repo-b') return Promise.resolve([{ name: 'other.ts', path: 'other.ts', isDirectory: false }])
      if (path === '/repo-a/src') {
        srcLoadCount += 1
        if (srcLoadCount === 1) return slowDirectory.promise
        return Promise.resolve([{ name: 'current.ts', path: 'current.ts', isDirectory: false }])
      }
      return Promise.resolve([])
    })

    const { rerender } = render(<FileTree worktreePath="/repo-a" onFileSelect={vi.fn()} />)
    fireEvent.click(await screen.findByText('src'))

    rerender(<FileTree worktreePath="/repo-b" onFileSelect={vi.fn()} />)
    await screen.findByText('other.ts')

    rerender(<FileTree worktreePath="/repo-a" onFileSelect={vi.fn()} />)
    await screen.findByText('src')

    slowDirectory.resolve([{ name: 'stale.ts', path: 'stale.ts', isDirectory: false }])
    await waitFor(() => {
      expect(screen.queryByText('stale.ts')).toBeNull()
    })

    fireEvent.click(screen.getByText('src'))
    await screen.findByText('current.ts')
    expect(screen.queryByText('stale.ts')).toBeNull()
  })

  it('handles nullish root file tree responses defensively', async () => {
    getFileTree.mockResolvedValue(undefined)

    render(<FileTree worktreePath="/repo" onFileSelect={vi.fn()} />)

    await waitFor(() => {
      expect(getFileTree).toHaveBeenCalledWith('/repo', false)
    })
    expect(screen.queryByText('fileCount')).toBeNull()
  })

  it('handles nullish directory file tree responses defensively', async () => {
    getFileTree.mockImplementation((path: string) => {
      if (path === '/repo') return Promise.resolve([{ name: 'src', path: 'src', isDirectory: true }])
      if (path === '/repo/src') return Promise.resolve(null)
      return Promise.resolve(undefined)
    })

    render(<FileTree worktreePath="/repo" onFileSelect={vi.fn()} />)
    fireEvent.click(await screen.findByText('src'))

    await waitFor(() => {
      expect(getFileTree).toHaveBeenCalledWith('/repo/src', false)
    })
    expect(screen.queryByText('index.ts')).toBeNull()
  })
})
