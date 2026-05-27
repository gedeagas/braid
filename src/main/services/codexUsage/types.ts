// Internal types for the codex-usage scanner and store (main process only)

export interface CodexUsageProcessedFile {
  path: string
  mtimeMs: number
  size: number
}

export interface CodexUsageLocationBreakdown {
  locationKey: string
  projectLabel: string
  worktreeId: string | null
  eventCount: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface CodexUsageSession {
  sessionId: string
  firstTimestamp: string
  lastTimestamp: string
  model: string | null
  primaryProjectLabel: string
  primaryWorktreeId: string | null
  eventCount: number
  totalInputTokens: number
  totalCachedInputTokens: number
  totalOutputTokens: number
  totalReasoningOutputTokens: number
  totalTokens: number
  locationBreakdown: CodexUsageLocationBreakdown[]
}

export interface CodexUsageDailyAggregate {
  day: string
  model: string | null
  projectKey: string
  projectLabel: string
  worktreeId: string | null
  eventCount: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface CodexUsagePersistedState {
  schemaVersion: number
  worktreeFingerprint: string | null
  processedFiles: CodexUsagePersistedFile[]
  sessions: CodexUsageSession[]
  dailyAggregates: CodexUsageDailyAggregate[]
  scanState: {
    enabled: boolean
    lastScanStartedAt: number | null
    lastScanCompletedAt: number | null
    lastScanError: string | null
  }
}

export interface CodexUsagePersistedFile extends CodexUsageProcessedFile {
  sessions: CodexUsageSession[]
  dailyAggregates: CodexUsageDailyAggregate[]
}

export interface CodexUsageParsedEvent {
  sessionId: string
  timestamp: string
  model: string | null
  cwd: string | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface CodexUsageAttributedEvent extends CodexUsageParsedEvent {
  day: string
  projectKey: string
  projectLabel: string
  worktreeId: string | null
}

export interface CodexUsageWorktreeRef {
  worktreeId: string
  path: string
  displayName: string
}
