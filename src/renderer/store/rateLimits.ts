import { create } from 'zustand'
import type { RateLimitState } from '../../shared/rate-limit-types'
import * as ipc from '@/lib/ipc'

interface RateLimitsStore {
  state: RateLimitState
  isRefreshing: boolean
  refresh: () => Promise<void>
}

export const useRateLimitsStore = create<RateLimitsStore>((set) => ({
  state: { claude: null, codex: null },
  isRefreshing: false,

  refresh: async () => {
    set({ isRefreshing: true })
    try {
      const fresh = await ipc.rateLimits.refresh()
      set({ state: fresh })
    } catch (err) {
      console.error('Failed to refresh rate limits:', err)
    } finally {
      set({ isRefreshing: false })
    }
  },
}))

if (typeof window !== 'undefined') {
  ipc.rateLimits.get()
    .then((state) => useRateLimitsStore.setState({ state }))
    .catch((err) => console.error('Failed to fetch initial rate limits:', err))

  ipc.rateLimits.onUpdate((state) => {
    useRateLimitsStore.setState({ state })
  })
}
