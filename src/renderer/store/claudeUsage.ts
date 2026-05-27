import { create } from 'zustand'
import * as ipc from '@/lib/ipc'
import type {
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageRange,
  ClaudeUsageScanState,
  ClaudeUsageScope,
  ClaudeUsageSessionRow,
  ClaudeUsageSnapshot,
  ClaudeUsageSummary,
} from '../../shared/claude-usage-types'

interface ClaudeUsageState {
  scope: ClaudeUsageScope
  range: ClaudeUsageRange
  scanState: ClaudeUsageScanState | null
  summary: ClaudeUsageSummary | null
  daily: ClaudeUsageDailyPoint[]
  modelBreakdown: ClaudeUsageBreakdownRow[]
  projectBreakdown: ClaudeUsageBreakdownRow[]
  recentSessions: ClaudeUsageSessionRow[]
  isLoading: boolean
  error: string | null

  setEnabled: (enabled: boolean) => Promise<void>
  clearData: () => Promise<void>
  setScope: (scope: ClaudeUsageScope) => Promise<void>
  setRange: (range: ClaudeUsageRange) => Promise<void>
  fetchUsage: (opts?: { forceRefresh?: boolean }) => Promise<void>
  refreshUsage: () => Promise<void>
}

let fetchRequestId = 0

function emptyUsageState() {
  return {
    summary: null,
    daily: [],
    modelBreakdown: [],
    projectBreakdown: [],
    recentSessions: [],
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const useClaudeUsageStore = create<ClaudeUsageState>((set, get) => ({
  scope: 'braid',
  range: '30d',
  scanState: null,
  summary: null,
  daily: [],
  modelBreakdown: [],
  projectBreakdown: [],
  recentSessions: [],
  isLoading: false,
  error: null,

  setEnabled: async (enabled) => {
    try {
      const scanState = await ipc.claudeUsage.setEnabled({ enabled }) as ClaudeUsageScanState
      set({
        scanState: enabled
          ? { ...scanState, isScanning: true, lastScanCompletedAt: null, lastScanError: null }
          : scanState,
        ...emptyUsageState(),
        isLoading: enabled,
        error: null,
      })
      if (enabled) await get().fetchUsage({ forceRefresh: true })
    } catch (err) {
      console.error('Failed to update Claude usage setting:', err)
      set({ isLoading: false, error: getErrorMessage(err) })
    }
  },

  clearData: async () => {
    try {
      const scanState = await ipc.claudeUsage.clearData() as ClaudeUsageScanState
      set({
        scanState,
        ...emptyUsageState(),
        isLoading: false,
        error: null,
      })
    } catch (err) {
      console.error('Failed to clear Claude usage data:', err)
      set({ error: getErrorMessage(err) })
    }
  },

  setScope: async (scope) => {
    set({ scope, ...emptyUsageState() })
    await get().fetchUsage()
  },

  setRange: async (range) => {
    set({ range, ...emptyUsageState() })
    await get().fetchUsage()
  },

  fetchUsage: async (opts) => {
    const requestId = ++fetchRequestId
    const { scope, range } = get()
    set({ isLoading: true, error: null })

    try {
      const snapshot = await ipc.claudeUsage.getSnapshot({
        scope,
        range,
        limit: 10,
        force: opts?.forceRefresh ?? false,
      }) as ClaudeUsageSnapshot
      if (requestId !== fetchRequestId) return

      set({
        scanState: snapshot.scanState,
        ...(snapshot.scanState.enabled
          ? {
              summary: snapshot.summary,
              daily: snapshot.daily,
              modelBreakdown: snapshot.modelBreakdown,
              projectBreakdown: snapshot.projectBreakdown,
              recentSessions: snapshot.recentSessions,
            }
          : emptyUsageState()),
        isLoading: false,
        error: null,
      })
    } catch (err) {
      console.error('Failed to fetch Claude usage:', err)
      if (requestId === fetchRequestId) {
        set({ isLoading: false, error: getErrorMessage(err) })
      }
    }
  },

  refreshUsage: async () => {
    await get().fetchUsage({ forceRefresh: true })
  },
}))
