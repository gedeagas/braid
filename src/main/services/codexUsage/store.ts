import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type {
  CodexUsageBreakdownKind,
  CodexUsageBreakdownRow,
  CodexUsageDailyPoint,
  CodexUsageRange,
  CodexUsageScanState,
  CodexUsageScope,
  CodexUsageSessionRow,
  CodexUsageSnapshot,
  CodexUsageSummary,
} from '../../../shared/codex-usage-types'
import type { CodexUsagePersistedState, CodexUsageWorktreeRef } from './types'
import { scanCodexUsageFiles } from './scanner'
import { logger } from '../../lib/logger'

const SCHEMA_VERSION = 1
const STALE_MS = 5 * 60_000

type ModelPricing = { input: number; cachedInput: number; output: number }

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'o3': { input: 2, cachedInput: 0.5, output: 8 },
  'o3-pro': { input: 20, cachedInput: 5, output: 80 },
  'o4-mini': { input: 0.55, cachedInput: 0.1375, output: 2.2 },
  'gpt-4.1': { input: 2, cachedInput: 0.5, output: 8 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
}

function normalizeModelForPricing(model: string | null): string | null {
  if (!model) return null
  const lower = model.toLowerCase().trim()
  if (MODEL_PRICING[lower]) return lower
  for (const key of Object.keys(MODEL_PRICING)) {
    if (lower.includes(key)) return key
  }
  return null
}

function estimateCostUsd(
  model: string | null,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number
): number | null {
  const normalized = normalizeModelForPricing(model)
  if (!normalized) return null
  const p = MODEL_PRICING[normalized]
  if (!p) return null
  const uncachedInput = Math.max(inputTokens - cachedInputTokens, 0)
  return (uncachedInput * p.input + cachedInputTokens * p.cachedInput + outputTokens * p.output) / 1_000_000
}

function getRangeCutoff(range: CodexUsageRange): string | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() - (days - 1))
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function getLocalDay(ts: string): string | null {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDefaultState(): CodexUsagePersistedState {
  return {
    schemaVersion: SCHEMA_VERSION, worktreeFingerprint: null,
    processedFiles: [], sessions: [], dailyAggregates: [],
    scanState: { enabled: false, lastScanStartedAt: null, lastScanCompletedAt: null, lastScanError: null },
  }
}

type WorktreeProvider = () => CodexUsageWorktreeRef[]

export class CodexUsageStore {
  private state: CodexUsagePersistedState
  private scanPromise: Promise<void> | null = null
  private getWorktrees: WorktreeProvider

  constructor(getWorktrees: WorktreeProvider) {
    this.getWorktrees = getWorktrees
    this.state = this.load()
  }

  private get filePath(): string {
    return join(app.getPath('userData'), 'braid-codex-usage.json')
  }

  private load(): CodexUsagePersistedState {
    try {
      if (!existsSync(this.filePath)) return getDefaultState()
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as CodexUsagePersistedState
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        const d = getDefaultState()
        return { ...d, scanState: { ...d.scanState, enabled: parsed.scanState?.enabled ?? false } }
      }
      return { ...getDefaultState(), ...parsed, scanState: { ...getDefaultState().scanState, ...parsed.scanState } }
    } catch (err) {
      logger.error('[codex-usage] Failed to load persisted state:', err)
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

  private getWorktreeFingerprint(refs: CodexUsageWorktreeRef[]): string {
    return JSON.stringify(refs.map((r) => `${r.worktreeId}:${r.path}`).sort())
  }

  async setEnabled(enabled: boolean): Promise<CodexUsageScanState> {
    this.state.scanState.enabled = enabled
    this.writeToDisk()
    return this.getScanState()
  }

  async clearData(): Promise<CodexUsageScanState> {
    const enabled = this.state.scanState.enabled
    this.state = getDefaultState()
    this.state.scanState.enabled = enabled
    this.writeToDisk()
    return this.getScanState()
  }

  getScanState(): CodexUsageScanState {
    return {
      ...this.state.scanState,
      isScanning: this.scanPromise !== null,
      hasAnyData: this.state.sessions.length > 0,
    }
  }

  async refresh(force = false): Promise<CodexUsageScanState> {
    if (!this.state.scanState.enabled) return this.getScanState()
    if (!force && this.state.scanState.lastScanCompletedAt) {
      if (Date.now() - this.state.scanState.lastScanCompletedAt < STALE_MS) {
        return this.getScanState()
      }
    }
    const worktrees = this.getWorktrees()
    await this.runScan(worktrees, this.getWorktreeFingerprint(worktrees))
    return this.getScanState()
  }

  private async runScan(worktrees?: CodexUsageWorktreeRef[], fingerprint?: string): Promise<void> {
    if (this.scanPromise) { await this.scanPromise; return }
    const nextWorktrees = worktrees ?? this.getWorktrees()
    const nextFingerprint = fingerprint ?? this.getWorktreeFingerprint(nextWorktrees)
    this.state.scanState.lastScanStartedAt = Date.now()
    this.state.scanState.lastScanError = null
    this.writeToDisk()

    this.scanPromise = (async () => {
      try {
        const result = await scanCodexUsageFiles(nextWorktrees, this.state.worktreeFingerprint === nextFingerprint ? this.state.processedFiles : [])
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
      } finally { this.scanPromise = null }
    })()
    await this.scanPromise
  }

  private getFilteredDaily(scope: CodexUsageScope, range: CodexUsageRange) {
    const cutoff = getRangeCutoff(range)
    return this.state.dailyAggregates.filter((e) => {
      if (cutoff && e.day < cutoff) return false
      if (scope === 'braid' && e.worktreeId === null) return false
      return true
    })
  }

  private getFilteredSessions(scope: CodexUsageScope, range: CodexUsageRange) {
    const cutoff = getRangeCutoff(range)
    return this.state.sessions.filter((s) => {
      const day = getLocalDay(s.lastTimestamp)
      if (!day || (cutoff && day < cutoff)) return false
      if (scope === 'braid') return s.locationBreakdown.some((e) => e.worktreeId !== null)
      return true
    })
  }

  private buildSummary(scope: CodexUsageScope, range: CodexUsageRange): CodexUsageSummary {
    const daily = this.getFilteredDaily(scope, range)
    const sessions = this.getFilteredSessions(scope, range)
    let inp = 0, cached = 0, out = 0, reasoning = 0, total = 0, evts = 0
    let cost = 0, hasCost = false
    const byModel = new Map<string, number>()
    const byProject = new Map<string, number>()

    for (const d of daily) {
      inp += d.inputTokens; cached += d.cachedInputTokens
      out += d.outputTokens; reasoning += d.reasoningOutputTokens
      total += d.totalTokens; evts += d.eventCount
      byModel.set(d.model ?? 'Unknown', (byModel.get(d.model ?? 'Unknown') ?? 0) + d.totalTokens)
      byProject.set(d.projectLabel, (byProject.get(d.projectLabel) ?? 0) + d.totalTokens)
      const c = estimateCostUsd(d.model, d.inputTokens, d.cachedInputTokens, d.outputTokens)
      if (c !== null) { hasCost = true; cost += c }
    }

    return {
      scope, range, sessions: sessions.length, events: evts,
      inputTokens: inp, cachedInputTokens: cached, outputTokens: out,
      reasoningOutputTokens: reasoning, totalTokens: total,
      estimatedCostUsd: hasCost ? cost : null,
      topModel: [...byModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      topProject: [...byProject.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      hasAnyData: sessions.length > 0 || daily.length > 0,
    }
  }

  async getSummary(scope: CodexUsageScope, range: CodexUsageRange): Promise<CodexUsageSummary> {
    await this.refresh(false)
    return this.buildSummary(scope, range)
  }

  private buildDaily(scope: CodexUsageScope, range: CodexUsageRange): CodexUsageDailyPoint[] {
    const byDay = new Map<string, CodexUsageDailyPoint>()
    for (const d of this.getFilteredDaily(scope, range)) {
      const ex = byDay.get(d.day) ?? { day: d.day, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 }
      ex.inputTokens += d.inputTokens; ex.cachedInputTokens += d.cachedInputTokens
      ex.outputTokens += d.outputTokens; ex.reasoningOutputTokens += d.reasoningOutputTokens
      ex.totalTokens += d.totalTokens
      byDay.set(d.day, ex)
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  }

  async getDaily(scope: CodexUsageScope, range: CodexUsageRange): Promise<CodexUsageDailyPoint[]> {
    await this.refresh(false)
    return this.buildDaily(scope, range)
  }

  private buildBreakdown(scope: CodexUsageScope, range: CodexUsageRange, kind: CodexUsageBreakdownKind): CodexUsageBreakdownRow[] {
    const rows = new Map<string, CodexUsageBreakdownRow>()
    for (const d of this.getFilteredDaily(scope, range)) {
      const key = kind === 'model' ? (d.model ?? 'unknown') : d.projectKey
      const label = kind === 'model' ? (d.model ?? 'Unknown model') : d.projectLabel
      const ex = rows.get(key) ?? { key, label, sessions: 0, events: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, estimatedCostUsd: null }
      ex.events += d.eventCount; ex.inputTokens += d.inputTokens; ex.cachedInputTokens += d.cachedInputTokens
      ex.outputTokens += d.outputTokens; ex.reasoningOutputTokens += d.reasoningOutputTokens; ex.totalTokens += d.totalTokens
      rows.set(key, ex)
    }
    for (const s of this.getFilteredSessions(scope, range)) {
      if (kind === 'model') { const r = rows.get(s.model ?? 'unknown'); if (r) r.sessions++ }
      else { for (const l of s.locationBreakdown) { const r = rows.get(l.locationKey); if (r) r.sessions++ } }
    }
    for (const r of rows.values()) {
      if (kind === 'model') r.estimatedCostUsd = estimateCostUsd(r.key, r.inputTokens, r.cachedInputTokens, r.outputTokens)
    }
    return [...rows.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }

  async getBreakdown(scope: CodexUsageScope, range: CodexUsageRange, kind: CodexUsageBreakdownKind): Promise<CodexUsageBreakdownRow[]> {
    await this.refresh(false)
    return this.buildBreakdown(scope, range, kind)
  }

  private buildRecentSessions(scope: CodexUsageScope, range: CodexUsageRange, limit = 12): CodexUsageSessionRow[] {
    return this.getFilteredSessions(scope, range).slice(0, limit).map((s) => {
      const dur = Math.max(0, Math.round((new Date(s.lastTimestamp).getTime() - new Date(s.firstTimestamp).getTime()) / 60_000))
      return {
        sessionId: s.sessionId, lastActiveAt: s.lastTimestamp, durationMinutes: dur,
        projectLabel: s.primaryProjectLabel, model: s.model, events: s.eventCount,
        inputTokens: s.totalInputTokens, cachedInputTokens: s.totalCachedInputTokens,
        outputTokens: s.totalOutputTokens, reasoningOutputTokens: s.totalReasoningOutputTokens,
        totalTokens: s.totalTokens,
      }
    })
  }

  async getRecentSessions(scope: CodexUsageScope, range: CodexUsageRange, limit = 12): Promise<CodexUsageSessionRow[]> {
    await this.refresh(false)
    return this.buildRecentSessions(scope, range, limit)
  }

  async getSnapshot(
    scope: CodexUsageScope,
    range: CodexUsageRange,
    limit = 10,
    force = false
  ): Promise<CodexUsageSnapshot> {
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
