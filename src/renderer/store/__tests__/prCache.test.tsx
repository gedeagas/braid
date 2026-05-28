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
})
