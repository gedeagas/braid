import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type {
  ClaudeUsageBreakdownKind,
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageRange,
  ClaudeUsageScanState,
  ClaudeUsageScope,
  ClaudeUsageSessionRow,
  ClaudeUsageSnapshot,
  ClaudeUsageSummary,
} from '../../../shared/claude-usage-types'
import type { ClaudeUsagePersistedState } from './types'
import { getSessionProjectLabel, scanClaudeUsageFiles } from './scanner'
import type { ClaudeUsageWorktreeRef } from './types'
import { logger } from '../../lib/logger'

const SCHEMA_VERSION = 1
const STALE_MS = 5 * 60_000

type ModelPricing = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-haiku-3-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
}

function normalizeModelForPricing(model: string | null): string | null {
  if (!model) return null
  const lower = model.toLowerCase().trim().replace(/^anthropic[/:]/, '')

  if (lower.includes('opus-4-7')) return 'claude-opus-4-7'
  if (lower.includes('opus-4-6')) return 'claude-opus-4-6'
  if (lower.includes('opus-4-5')) return 'claude-opus-4-6'
  if (lower.includes('sonnet-4-6')) return 'claude-sonnet-4-6'
  if (lower.includes('sonnet-4-5') || lower.includes('sonnet-4')) return 'claude-sonnet-4-5'
  if (lower.includes('sonnet-3-7') || lower.includes('sonnet-3.7')) return 'claude-sonnet-4-5'
  if (lower.includes('sonnet-3-5') || lower.includes('sonnet-3.5') || lower.includes('3-5-sonnet') || lower.includes('3.5-sonnet')) return 'claude-sonnet-4-5'
  if (lower.includes('haiku-4-5')) return 'claude-haiku-4-5'
  if (lower.includes('haiku-3-5') || lower.includes('haiku-3.5') || lower.includes('3-5-haiku') || lower.includes('3.5-haiku')) return 'claude-haiku-3-5'
  return null
}

function estimateCostUsd(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
): number | null {
  const normalized = normalizeModelForPricing(model)
  if (!normalized) return null
  const p = MODEL_PRICING[normalized]
  if (!p) return null
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheReadTokens * p.cacheRead +
      cacheWriteTokens * p.cacheWrite) /
    1_000_000
  )
}

function getRangeCutoff(range: ClaudeUsageRange): string | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() - (days - 1))
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getLocalDay(ts: string): string | null {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getDefaultState(): ClaudeUsagePersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    worktreeFingerprint: null,
    processedFiles: [],
    sessions: [],
    dailyAggregates: [],
    scanState: {
      enabled: false,
      lastScanStartedAt: null,
      lastScanCompletedAt: null,
      lastScanError: null,
    },
  }
}

type WorktreeProvider = () => ClaudeUsageWorktreeRef[]

export class ClaudeUsageStore {
  private state: ClaudeUsagePersistedState
  private scanPromise: Promise<void> | null = null
  private getWorktrees: WorktreeProvider

  constructor(getWorktrees: WorktreeProvider) {
    this.getWorktrees = getWorktrees
    this.state = this.load()
  }

  private get filePath(): string {
    return join(app.getPath('userData'), 'braid-claude-usage.json')
  }

  private load(): ClaudeUsagePersistedState {
    try {
      if (!existsSync(this.filePath)) return getDefaultState()
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as ClaudeUsagePersistedState
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        const defaults = getDefaultState()
        return {
          ...defaults,
          scanState: {
            ...defaults.scanState,
            enabled: parsed.scanState?.enabled ?? false,
          },
        }
      }
      return { ...getDefaultState(), ...parsed, scanState: { ...getDefaultState().scanState, ...parsed.scanState } }
    } catch (err) {
      logger.error('[claude-usage] Failed to load persisted state:', err)
      return getDefaultState()
    }
  }

  private writeToDisk(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8')
    renameSync(tmp, this.filePath)
  }

  private getWorktreeFingerprint(refs: ClaudeUsageWorktreeRef[]): string {
    return JSON.stringify(refs.map((r) => `${r.worktreeId}:${r.path}`).sort())
  }

  async setEnabled(enabled: boolean): Promise<ClaudeUsageScanState> {
    this.state.scanState.enabled = enabled
    this.writeToDisk()
    return this.getScanState()
  }

  async clearData(): Promise<ClaudeUsageScanState> {
    const enabled = this.state.scanState.enabled
    this.state = getDefaultState()
    this.state.scanState.enabled = enabled
    this.writeToDisk()
    return this.getScanState()
  }

  getScanState(): ClaudeUsageScanState {
    return {
      ...this.state.scanState,
      isScanning: this.scanPromise !== null,
      hasAnyData: this.state.sessions.length > 0 || this.state.dailyAggregates.length > 0,
    }
  }

  async refresh(force = false): Promise<ClaudeUsageScanState> {
    if (!this.state.scanState.enabled) return this.getScanState()
    if (!force && this.state.scanState.lastScanCompletedAt) {
      const age = Date.now() - this.state.scanState.lastScanCompletedAt
      if (age < STALE_MS) {
        return this.getScanState()
      }
    }
    const worktrees = this.getWorktrees()
    await this.runScan(worktrees, this.getWorktreeFingerprint(worktrees))
    return this.getScanState()
  }

  private async runScan(worktrees?: ClaudeUsageWorktreeRef[], fingerprint?: string): Promise<void> {
    if (this.scanPromise) {
      await this.scanPromise
      return
    }

    const nextWorktrees = worktrees ?? this.getWorktrees()
    const nextFingerprint = fingerprint ?? this.getWorktreeFingerprint(nextWorktrees)

    this.state.scanState.lastScanStartedAt = Date.now()
    this.state.scanState.lastScanError = null
    this.writeToDisk()

    this.scanPromise = (async () => {
      try {
        const result = await scanClaudeUsageFiles(
          nextWorktrees,
          this.state.worktreeFingerprint === nextFingerprint ? this.state.processedFiles : []
        )
        this.state.processedFiles = result.processedFiles
        this.state.sessions = result.sessions
        this.state.dailyAggregates = result.dailyAggregates
        this.state.worktreeFingerprint = nextFingerprint
        this.state.scanState.lastScanCompletedAt = Date.now()
        this.state.scanState.lastScanError = null
        this.writeToDisk()
      } catch (err) {
        this.state.scanState.lastScanError = err instanceof Error ? err.message : String(err)
        this.writeToDisk()
      } finally {
        this.scanPromise = null
      }
    })()

    await this.scanPromise
  }

  private getFilteredDaily(scope: ClaudeUsageScope, range: ClaudeUsageRange) {
    const cutoff = getRangeCutoff(range)
    return this.state.dailyAggregates.filter((e) => {
      if (cutoff && e.day < cutoff) return false
      if (scope === 'braid' && e.worktreeId === null) return false
      return true
    })
  }

  private getFilteredSessions(scope: ClaudeUsageScope, range: ClaudeUsageRange) {
    const cutoff = getRangeCutoff(range)
    return this.state.sessions.filter((s) => {
      const day = getLocalDay(s.lastTimestamp)
      if (!day) return false
      if (cutoff && day < cutoff) return false
      if (scope === 'braid') return s.locationBreakdown.some((e) => e.worktreeId !== null)
      return true
    })
  }

  private buildSummary(scope: ClaudeUsageScope, range: ClaudeUsageRange): ClaudeUsageSummary {
    const daily = this.getFilteredDaily(scope, range)
    const sessions = this.getFilteredSessions(scope, range)

    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0
    let turns = 0, zeroCacheReadTurns = 0
    const byModel = new Map<string, number>()
    const byProject = new Map<string, number>()
    let totalCost = 0
    let hasCost = false

    for (const row of daily) {
      inputTokens += row.inputTokens
      outputTokens += row.outputTokens
      cacheReadTokens += row.cacheReadTokens
      cacheWriteTokens += row.cacheWriteTokens
      turns += row.turnCount
      zeroCacheReadTurns += row.zeroCacheReadTurnCount
      const mk = row.model ?? 'Unknown model'
      byModel.set(mk, (byModel.get(mk) ?? 0) + row.inputTokens + row.outputTokens)
      byProject.set(row.projectLabel, (byProject.get(row.projectLabel) ?? 0) + row.inputTokens + row.outputTokens)
      const cost = estimateCostUsd(row.model, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens)
      if (cost !== null) { hasCost = true; totalCost += cost }
    }

    const topModel = [...byModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const topProject = [...byProject.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    return {
      scope, range,
      sessions: sessions.length, turns, zeroCacheReadTurns,
      inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
      cacheReuseRate: inputTokens + cacheReadTokens > 0
        ? cacheReadTokens / (inputTokens + cacheReadTokens)
        : null,
      estimatedCostUsd: hasCost ? totalCost : null,
      topModel, topProject,
      hasAnyData: sessions.length > 0 || daily.length > 0,
    }
  }

  async getSummary(scope: ClaudeUsageScope, range: ClaudeUsageRange): Promise<ClaudeUsageSummary> {
    await this.refresh(false)
    return this.buildSummary(scope, range)
  }

  private buildDaily(scope: ClaudeUsageScope, range: ClaudeUsageRange): ClaudeUsageDailyPoint[] {
    const byDay = new Map<string, ClaudeUsageDailyPoint>()
    for (const row of this.getFilteredDaily(scope, range)) {
      const existing = byDay.get(row.day) ?? { day: row.day, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      existing.inputTokens += row.inputTokens
      existing.outputTokens += row.outputTokens
      existing.cacheReadTokens += row.cacheReadTokens
      existing.cacheWriteTokens += row.cacheWriteTokens
      byDay.set(row.day, existing)
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  }

  async getDaily(scope: ClaudeUsageScope, range: ClaudeUsageRange): Promise<ClaudeUsageDailyPoint[]> {
    await this.refresh(false)
    return this.buildDaily(scope, range)
  }

  private buildBreakdown(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    kind: ClaudeUsageBreakdownKind
  ): ClaudeUsageBreakdownRow[] {
    const rows = new Map<string, ClaudeUsageBreakdownRow>()
    const daily = this.getFilteredDaily(scope, range)
    const sessions = this.getFilteredSessions(scope, range)

    for (const d of daily) {
      const key = kind === 'model' ? (d.model ?? 'unknown') : d.projectKey
      const label = kind === 'model' ? (d.model ?? 'Unknown model') : d.projectLabel
      const existing = rows.get(key) ?? { key, label, sessions: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: null }
      existing.turns += d.turnCount
      existing.inputTokens += d.inputTokens
      existing.outputTokens += d.outputTokens
      existing.cacheReadTokens += d.cacheReadTokens
      existing.cacheWriteTokens += d.cacheWriteTokens
      rows.set(key, existing)
    }

    for (const s of sessions) {
      if (kind === 'model') {
        const key = s.model ?? 'unknown'
        const row = rows.get(key)
        if (row) row.sessions++
        continue
      }
      const matching = s.locationBreakdown.filter((e) =>
        scope === 'all' ? true : e.worktreeId !== null
      )
      const seen = new Set<string>()
      for (const loc of matching) {
        if (seen.has(loc.locationKey)) continue
        seen.add(loc.locationKey)
        const row = rows.get(loc.locationKey)
        if (row) row.sessions++
      }
    }

    for (const row of rows.values()) {
      if (kind === 'model') {
        row.estimatedCostUsd = estimateCostUsd(row.key, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens)
      }
    }

    return [...rows.values()].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
  }

  async getBreakdown(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    kind: ClaudeUsageBreakdownKind
  ): Promise<ClaudeUsageBreakdownRow[]> {
    await this.refresh(false)
    return this.buildBreakdown(scope, range, kind)
  }

  private buildRecentSessions(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    limit = 12
  ): ClaudeUsageSessionRow[] {
    return this.getFilteredSessions(scope, range)
      .slice(0, limit)
      .map((s) => {
        const matching = s.locationBreakdown.filter((e) =>
          scope === 'all' ? true : e.worktreeId !== null
        )
        const locations = matching.length > 0 ? matching : s.locationBreakdown
        const totals = locations.reduce(
          (acc, e) => ({
            turns: acc.turns + e.turnCount,
            inputTokens: acc.inputTokens + e.inputTokens,
            outputTokens: acc.outputTokens + e.outputTokens,
            cacheReadTokens: acc.cacheReadTokens + e.cacheReadTokens,
            cacheWriteTokens: acc.cacheWriteTokens + e.cacheWriteTokens,
          }),
          { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
        )
        const durationMinutes = Math.max(
          0,
          Math.round((new Date(s.lastTimestamp).getTime() - new Date(s.firstTimestamp).getTime()) / 60_000)
        )
        return {
          sessionId: s.sessionId,
          lastActiveAt: s.lastTimestamp,
          durationMinutes,
          projectLabel: getSessionProjectLabel(locations),
          branch: s.lastGitBranch,
          model: s.model,
          turns: totals.turns,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          cacheReadTokens: totals.cacheReadTokens,
          cacheWriteTokens: totals.cacheWriteTokens,
          }
        })
  }

  async getRecentSessions(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    limit = 12
  ): Promise<ClaudeUsageSessionRow[]> {
    await this.refresh(false)
    return this.buildRecentSessions(scope, range, limit)
  }

  async getSnapshot(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    limit = 10,
    force = false
  ): Promise<ClaudeUsageSnapshot> {
    const scanState = await this.refresh(force)
    return {
      scanState,
      summary: this.buildSummary(scope, range),
      daily: this.buildDaily(scope, range),
      modelBreakdown: this.buildBreakdown(scope, range, 'model'),
      projectBreakdown: this.buildBreakdown(scope, range, 'project'),
      recentSessions: this.buildRecentSessions(scope, range, limit),
    }
  }
}
