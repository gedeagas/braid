export type RateLimitWindow = {
  usedPercent: number
  windowMinutes: number
  resetsAt: number | null
  resetDescription: string | null
}

export type ProviderRateLimitStatus = 'idle' | 'fetching' | 'ok' | 'error' | 'unavailable'

export type ProviderRateLimits = {
  provider: 'claude' | 'codex'
  session: RateLimitWindow | null
  weekly: RateLimitWindow | null
  updatedAt: number
  error: string | null
  status: ProviderRateLimitStatus
}

export type RateLimitState = {
  claude: ProviderRateLimits | null
  codex: ProviderRateLimits | null
}

// ── Resource Usage ─────────────────────────────────────────────────────────

export type UsageValues = { cpu: number; memory: number }

export type AppMemory = UsageValues & {
  main: UsageValues
  renderer: UsageValues
  other: UsageValues
  history: number[]
}

export type HostMemory = {
  totalMemory: number
  freeMemory: number
  usedMemory: number
  memoryUsagePercent: number
  cpuCoreCount: number
  loadAverage1m: number
}

export type PtyUsageEntry = {
  ptyId: string
  cwd: string
  pid: number | null
  cpu: number
  memory: number
}

export type ResourceSnapshot = {
  app: AppMemory
  ptyUsage: PtyUsageEntry[]
  host: HostMemory
  totalCpu: number
  totalMemory: number
  collectedAt: number
}
