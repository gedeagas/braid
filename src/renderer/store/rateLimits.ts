// ---------------------------------------------------------------------------
// Global rate limit store — account-wide, shared across all sessions
// ---------------------------------------------------------------------------
//
// Rate limits are per-account, not per-session. Any session that receives a
// rate_limit_event updates this global store so every RateLimitBars instance
// reacts immediately — even if the event came from a different session.
//
// Hydrates from localStorage on init. Persists on every update with TTL-based
// expiry matching the rate limit window (5h, 7d, etc.).
//

import { create } from 'zustand'
import { loadRateLimits, saveRateLimitEntry } from '@/lib/rateLimitCache'
import type { RateLimitInfo } from '@/types'

interface RateLimitsState {
  /** Keyed by rateLimitType (five_hour, seven_day, etc.) */
  limits: Record<string, RateLimitInfo>

  /** Called from eventHandler when any session receives a rate_limit_event */
  update: (entry: RateLimitInfo) => void
}

export const useRateLimitsStore = create<RateLimitsState>((set) => ({
  limits: loadRateLimits() ?? {},

  update: (entry) => {
    set((s) => ({
      limits: { ...s.limits, [entry.rateLimitType]: entry }
    }))
    saveRateLimitEntry(entry)
  },
}))

// Listen for cross-window localStorage changes (different Electron windows / worktrees)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key?.endsWith(':rateLimits') && e.newValue) {
      const fresh = loadRateLimits()
      if (fresh) {
        useRateLimitsStore.setState({ limits: fresh })
      }
    }
  })
}
