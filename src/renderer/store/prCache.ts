import { create } from 'zustand'
import * as ipc from '@/lib/ipc'
import { isOnline } from '@/lib/online'
import { subscribeWorktreeRefresh } from '@/lib/worktreeRefresh'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PrStatus {
  number: number
  title: string
  state: string
  url: string
  headBranch: string
  isDraft: boolean
  mergeable?: string
  baseRefName?: string
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | '' */
  reviewDecision?: string
  /** BEHIND | BLOCKED | CLEAN | DIRTY | DRAFT | HAS_HOOKS | UNKNOWN | UNSTABLE */
  mergeStateStatus?: string
}

interface PrEntry {
  data: PrStatus | null
  fetchedAt: number
  loading: boolean
}

interface PrCacheState {
  cache: Record<string, PrEntry>

  /** Fetch (or re-fetch) the PR status for a path. Deduplicates in-flight requests. */
  fetchPr: (worktreePath: string, options?: { force?: boolean }) => Promise<void>

  /** Register a path so the periodic refresh knows about it. */
  trackPath: (worktreePath: string) => void

  /** Unregister a path (called when the component unmounts). */
  untrackPath: (worktreePath: string) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

/** Paths that currently have a mounted PrIcon — only these get polled. */
const trackedPaths = new Set<string>()

/** In-flight fetch promises — prevents duplicate concurrent requests. */
const inFlight = new Set<string>()
const inFlightForce = new Set<string>()
const queuedForceRefreshes = new Set<string>()

export const usePrCacheStore = create<PrCacheState>((set, get) => ({
  cache: {},

  fetchPr: async (worktreePath, options) => {
    if (!worktreePath) return
    if (inFlight.has(worktreePath)) {
      if (options?.force && !inFlightForce.has(worktreePath)) {
        queuedForceRefreshes.add(worktreePath)
      }
      return
    }
    inFlight.add(worktreePath)
    if (options?.force) {
      inFlightForce.add(worktreePath)
    } else {
      inFlightForce.delete(worktreePath)
    }

    // Mark as loading (only if we don't already have data)
    const existing = get().cache[worktreePath]
    if (!existing) {
      set((s) => ({
        cache: {
          ...s.cache,
          [worktreePath]: { data: null, fetchedAt: 0, loading: true }
        }
      }))
    }

    try {
      const data = await ipc.github.getPrStatus(worktreePath, options?.force)
      set((s) => ({
        cache: {
          ...s.cache,
          [worktreePath]: {
            data: (data as PrStatus | null) ?? null,
            fetchedAt: Date.now(),
            loading: false
          }
        }
      }))
    } catch {
      set((s) => ({
        cache: {
          ...s.cache,
          [worktreePath]: {
            data: s.cache[worktreePath]?.data ?? null,
            fetchedAt: Date.now(),
            loading: false
          }
        }
      }))
    } finally {
      const runQueuedForceRefresh = queuedForceRefreshes.delete(worktreePath)
      inFlight.delete(worktreePath)
      inFlightForce.delete(worktreePath)
      if (runQueuedForceRefresh) {
        void get().fetchPr(worktreePath, { force: true })
      }
    }
  },

  trackPath: (worktreePath) => {
    if (!worktreePath) return
    trackedPaths.add(worktreePath)
    // Trigger an immediate fetch if we don't have data yet
    const entry = get().cache[worktreePath]
    if (!entry || entry.fetchedAt === 0) {
      get().fetchPr(worktreePath)
    }
  },

  untrackPath: (worktreePath) => {
    trackedPaths.delete(worktreePath)
  }
}))

// ─── Periodic background refresh ─────────────────────────────────────────────
// One shared interval for all tracked paths — much cheaper than one per row.

// Main-process ServiceCache (30s TTL) handles short-lived deduplication,
// so the renderer can poll less aggressively.
const REFRESH_INTERVAL_MS = 90_000

setInterval(() => {
  if (!isOnline()) return
  const { fetchPr } = usePrCacheStore.getState()
  for (const path of trackedPaths) {
    fetchPr(path)
  }
}, REFRESH_INTERVAL_MS)

// ─── Convenience hook ─────────────────────────────────────────────────────────

import { useEffect } from 'react'

/**
 * Subscribe to the cached PR status for a given worktree path.
 * Registers the path for periodic polling on mount and cleans up on unmount.
 */
export function usePrStatus(
  worktreePath: string,
  options?: { forceRefreshOnMount?: boolean }
): PrStatus | null | undefined {
  const trackPath = usePrCacheStore((s) => s.trackPath)
  const untrackPath = usePrCacheStore((s) => s.untrackPath)
  const fetchPr = usePrCacheStore((s) => s.fetchPr)
  const entry = usePrCacheStore((s) => s.cache[worktreePath])

  useEffect(() => {
    if (!worktreePath) return
    trackPath(worktreePath)
    const current = usePrCacheStore.getState().cache[worktreePath]
    if (options?.forceRefreshOnMount && current && current.fetchedAt > 0) {
      void fetchPr(worktreePath, { force: true })
    }
    const unsubscribeRefresh = subscribeWorktreeRefresh(worktreePath, 'pr', (event) => {
      void fetchPr(worktreePath, { force: event.force })
    })
    return () => {
      unsubscribeRefresh()
      untrackPath(worktreePath)
    }
  }, [worktreePath, options?.forceRefreshOnMount, trackPath, untrackPath, fetchPr])

  // undefined = not yet loaded, null = loaded but no PR, PrStatus = has PR
  if (!entry || entry.fetchedAt === 0) return undefined
  return entry.data
}
