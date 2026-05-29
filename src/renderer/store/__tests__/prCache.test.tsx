import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrCacheStore, usePrStatus } from '../prCache'

vi.mock('@/lib/ipc', () => ({
  github: {
    getPrStatus: vi.fn().mockResolvedValue(null),
  },
}))

describe('usePrStatus', () => {
  let ipc: typeof import('@/lib/ipc')

  beforeEach(async () => {
    vi.clearAllMocks()
    usePrCacheStore.setState({
      cache: {
        '/repo': { data: null, fetchedAt: 123, loading: false },
      },
    })
    ipc = await import('@/lib/ipc')
  })

  it('force-refreshes cached PR status when requested on mount', async () => {
    renderHook(() => usePrStatus('/repo', { forceRefreshOnMount: true }))

    await waitFor(() => {
      expect(ipc.github.getPrStatus).toHaveBeenCalledWith('/repo', true)
    })
  })

  it('queues a forced refresh behind an in-flight non-forced fetch', async () => {
    let resolveFirst!: (value: null) => void
    let resolveSecond!: (value: null) => void
    vi.mocked(ipc.github.getPrStatus)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

    const firstFetch = usePrCacheStore.getState().fetchPr('/repo')
    await usePrCacheStore.getState().fetchPr('/repo', { force: true })

    expect(ipc.github.getPrStatus).toHaveBeenCalledTimes(1)
    expect(ipc.github.getPrStatus).toHaveBeenCalledWith('/repo', undefined)

    resolveFirst(null)
    await firstFetch

    await waitFor(() => {
      expect(ipc.github.getPrStatus).toHaveBeenCalledTimes(2)
      expect(ipc.github.getPrStatus).toHaveBeenLastCalledWith('/repo', true)
    })

    resolveSecond(null)
    await waitFor(() => {
      expect(usePrCacheStore.getState().cache['/repo']?.loading).toBe(false)
    })
  })
})
