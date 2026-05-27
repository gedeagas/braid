// Internal types for the claude-usage scanner and store (main process only)

export interface ClaudeUsageProcessedFile {
  path: string
  mtimeMs: number
  size: number
  lineCount: number
}

export interface ClaudeUsageLocationBreakdown {
  locationKey: string
  projectLabel: string
  worktreeId: string | null
  turnCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ClaudeUsageSession {
  sessionId: string
  firstTimestamp: string
  lastTimestamp: string
  model: string | null
  lastCwd: string | null
  lastGitBranch: string | null
  primaryWorktreeId: string | null
  turnCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  locationBreakdown: ClaudeUsageLocationBreakdown[]
}

export interface ClaudeUsageDailyAggregate {
  day: string
  model: string | null
  projectKey: string
  projectLabel: string
  worktreeId: string | null
  turnCount: number
  zeroCacheReadTurnCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ClaudeUsagePersistedState {
  schemaVersion: number
  worktreeFingerprint: string | null
  processedFiles: ClaudeUsagePersistedFile[]
  sessions: ClaudeUsageSession[]
  dailyAggregates: ClaudeUsageDailyAggregate[]
  scanState: {
    enabled: boolean
    lastScanStartedAt: number | null
    lastScanCompletedAt: number | null
    lastScanError: string | null
  }
}

export interface ClaudeUsagePersistedFile extends ClaudeUsageProcessedFile {
  sessions: ClaudeUsageSession[]
  dailyAggregates: ClaudeUsageDailyAggregate[]
}

export interface ClaudeUsageParsedTurn {
  sessionId: string
  timestamp: string
  model: string | null
  cwd: string | null
  gitBranch: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ClaudeUsageAttributedTurn extends ClaudeUsageParsedTurn {
  day: string
  projectKey: string
  projectLabel: string
  worktreeId: string | null
}

export interface ClaudeUsageWorktreeRef {
  worktreeId: string
  path: string
  displayName: string
}
