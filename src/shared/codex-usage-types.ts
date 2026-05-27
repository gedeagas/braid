// Shared types for Codex usage analytics (used by main, preload, and renderer)

export type CodexUsageScope = 'braid' | 'all'
export type CodexUsageRange = '7d' | '30d' | '90d' | 'all'
export type CodexUsageBreakdownKind = 'model' | 'project'

export interface CodexUsageScanState {
  enabled: boolean
  isScanning: boolean
  lastScanStartedAt: number | null
  lastScanCompletedAt: number | null
  lastScanError: string | null
  hasAnyData: boolean
}

export interface CodexUsageSummary {
  scope: CodexUsageScope
  range: CodexUsageRange
  sessions: number
  events: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  estimatedCostUsd: number | null
  topModel: string | null
  topProject: string | null
  hasAnyData: boolean
}

export interface CodexUsageDailyPoint {
  day: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface CodexUsageBreakdownRow {
  key: string
  label: string
  sessions: number
  events: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  estimatedCostUsd: number | null
}

export interface CodexUsageSessionRow {
  sessionId: string
  lastActiveAt: string
  durationMinutes: number
  projectLabel: string
  model: string | null
  events: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface CodexUsageSnapshot {
  scanState: CodexUsageScanState
  summary: CodexUsageSummary
  daily: CodexUsageDailyPoint[]
  modelBreakdown: CodexUsageBreakdownRow[]
  projectBreakdown: CodexUsageBreakdownRow[]
  recentSessions: CodexUsageSessionRow[]
}
