// Shared types for Claude usage analytics (used by main, preload, and renderer)

export type ClaudeUsageScope = 'braid' | 'all'
export type ClaudeUsageRange = '7d' | '30d' | '90d' | 'all'
export type ClaudeUsageBreakdownKind = 'model' | 'project'

export interface ClaudeUsageScanState {
  enabled: boolean
  isScanning: boolean
  lastScanStartedAt: number | null
  lastScanCompletedAt: number | null
  lastScanError: string | null
  hasAnyData: boolean
}

export interface ClaudeUsageSummary {
  scope: ClaudeUsageScope
  range: ClaudeUsageRange
  sessions: number
  turns: number
  zeroCacheReadTurns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheReuseRate: number | null
  estimatedCostUsd: number | null
  topModel: string | null
  topProject: string | null
  hasAnyData: boolean
}

export interface ClaudeUsageDailyPoint {
  day: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ClaudeUsageBreakdownRow {
  key: string
  label: string
  sessions: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  estimatedCostUsd: number | null
}

export interface ClaudeUsageSessionRow {
  sessionId: string
  lastActiveAt: string
  durationMinutes: number
  projectLabel: string
  branch: string | null
  model: string | null
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ClaudeUsageSnapshot {
  scanState: ClaudeUsageScanState
  summary: ClaudeUsageSummary
  daily: ClaudeUsageDailyPoint[]
  modelBreakdown: ClaudeUsageBreakdownRow[]
  projectBreakdown: ClaudeUsageBreakdownRow[]
  recentSessions: ClaudeUsageSessionRow[]
}
