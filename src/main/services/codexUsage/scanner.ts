import { homedir } from 'os'
import { join, basename } from 'path'
import { realpath, readdir, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import type {
  CodexUsageAttributedEvent,
  CodexUsageDailyAggregate,
  CodexUsageParsedEvent,
  CodexUsagePersistedFile,
  CodexUsageProcessedFile,
  CodexUsageSession,
  CodexUsageWorktreeRef,
} from './types'
import { USAGE_UNKNOWN_LOCATION_LABEL } from '../../../shared/usage-labels'

const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions')
const FILE_SCAN_BATCH_SIZE = 4

type RawRecord = {
  timestamp?: string
  type?: string
  payload?: Record<string, unknown>
}

type RawUsage = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

function ensureNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function normalizeComparablePath(p: string): string {
  const n = p.replace(/\\/g, '/')
  return process.platform === 'win32' ? n.toLowerCase() : n
}

async function canonicalizePath(p: string): Promise<string> {
  try { return normalizeComparablePath(await realpath(p)) }
  catch { return normalizeComparablePath(p) }
}

function isContainedPath(parent: string, child: string): boolean {
  const p = normalizeComparablePath(parent).replace(/\/+$/, '')
  const c = normalizeComparablePath(child).replace(/\/+$/, '')
  return c === p || c.startsWith(`${p}/`)
}

function getDefaultProjectLabel(cwd: string | null): string {
  if (!cwd) return USAGE_UNKNOWN_LOCATION_LABEL
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join('/')
  return parts.at(-1) ?? cwd
}

function localDay(ts: string): string | null {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function walkJsonlFiles(dirPath: string): Promise<string[]> {
  let entries
  try { entries = await readdir(dirPath, { withFileTypes: true }) }
  catch { return [] }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dirPath, entry.name)
    if (entry.isDirectory()) files.push(...(await walkJsonlFiles(full)))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full)
  }
  return files
}

export async function listCodexSessionFiles(): Promise<string[]> {
  return (await walkJsonlFiles(CODEX_SESSIONS_DIR)).sort()
}

function normalizeRawUsage(v: unknown): RawUsage | null {
  if (v == null || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const inp = ensureNum(r.input_tokens)
  const cached = ensureNum(r.cached_input_tokens ?? r.cache_read_input_tokens)
  const out = ensureNum(r.output_tokens)
  const reasoning = ensureNum(r.reasoning_output_tokens)
  const total = ensureNum(r.total_tokens)
  return {
    inputTokens: inp,
    cachedInputTokens: cached,
    outputTokens: out,
    reasoningOutputTokens: reasoning,
    totalTokens: total > 0 ? total : inp + out,
  }
}

function subtractUsage(current: RawUsage, previous: RawUsage | null): RawUsage {
  if (!previous) return current
  return {
    inputTokens: Math.max(current.inputTokens - previous.inputTokens, 0),
    cachedInputTokens: Math.max(current.cachedInputTokens - previous.cachedInputTokens, 0),
    outputTokens: Math.max(current.outputTokens - previous.outputTokens, 0),
    reasoningOutputTokens: Math.max(current.reasoningOutputTokens - previous.reasoningOutputTokens, 0),
    totalTokens: Math.max(current.totalTokens - previous.totalTokens, 0),
  }
}

function usageMagnitude(u: RawUsage): number {
  return u.inputTokens + u.cachedInputTokens + u.outputTokens + u.reasoningOutputTokens
}

async function parseCodexFile(filePath: string): Promise<{
  processedFile: CodexUsageProcessedFile
  events: CodexUsageParsedEvent[]
}> {
  const fileStat = await stat(filePath)
  const sessionId = basename(filePath, '.jsonl')
  const events: CodexUsageParsedEvent[] = []
  let currentModel: string | null = null
  let currentCwd: string | null = null
  let previousTotals: RawUsage | null = null

  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    let parsed: RawRecord
    try { parsed = JSON.parse(line) as RawRecord }
    catch { continue }

    if (!parsed.timestamp) continue
    const payload = parsed.payload ?? {}

    if (parsed.type === 'session_start' || parsed.type === 'session.start') {
      if (typeof payload.cwd === 'string') currentCwd = payload.cwd
      if (typeof payload.model === 'string') currentModel = payload.model
      continue
    }

    if (typeof payload.model === 'string') currentModel = payload.model
    if (typeof payload.cwd === 'string') currentCwd = payload.cwd

    const totalUsage = normalizeRawUsage(payload.total_usage ?? payload.totalUsage ?? payload.usage)
    const lastUsage = normalizeRawUsage(payload.last_turn_usage ?? payload.lastTurnUsage)

    if (!totalUsage && !lastUsage) continue

    let delta: RawUsage | null = null
    if (lastUsage && usageMagnitude(lastUsage) > 0) {
      delta = lastUsage
      if (totalUsage) previousTotals = totalUsage
    } else if (totalUsage) {
      if (previousTotals && usageMagnitude(subtractUsage(totalUsage, previousTotals)) > 0) {
        delta = subtractUsage(totalUsage, previousTotals)
      } else if (!previousTotals && usageMagnitude(totalUsage) > 0) {
        delta = totalUsage
      }
      previousTotals = totalUsage
    }

    if (!delta || usageMagnitude(delta) <= 0) continue

    events.push({
      sessionId,
      timestamp: parsed.timestamp,
      model: currentModel,
      cwd: currentCwd,
      inputTokens: delta.inputTokens,
      cachedInputTokens: delta.cachedInputTokens,
      outputTokens: delta.outputTokens,
      reasoningOutputTokens: delta.reasoningOutputTokens,
      totalTokens: delta.totalTokens,
    })
  }

  return {
    processedFile: { path: filePath, mtimeMs: fileStat.mtimeMs, size: fileStat.size },
    events,
  }
}

export async function buildWorktreeLookup(
  worktrees: CodexUsageWorktreeRef[]
): Promise<Map<string, CodexUsageWorktreeRef>> {
  const lookup = new Map<string, CodexUsageWorktreeRef>()
  for (const wt of worktrees) lookup.set(await canonicalizePath(wt.path), wt)
  return lookup
}

function findContainingWorktree(
  cwd: string,
  lookup: Map<string, CodexUsageWorktreeRef>,
  sortedEntries: Array<[string, CodexUsageWorktreeRef]>
): CodexUsageWorktreeRef | null {
  const n = normalizeComparablePath(cwd)
  const exact = lookup.get(n)
  if (exact) return exact
  for (const [p, wt] of sortedEntries) {
    if (isContainedPath(p, n)) return wt
  }
  return null
}

export async function attributeEvents(
  events: CodexUsageParsedEvent[],
  worktreeLookup: Map<string, CodexUsageWorktreeRef>
): Promise<CodexUsageAttributedEvent[]> {
  const result: CodexUsageAttributedEvent[] = []
  const cwdCache = new Map<string, string>()
  const sortedWorktrees = [...worktreeLookup.entries()].sort(([a], [b]) => b.length - a.length)

  for (const ev of events) {
    const day = localDay(ev.timestamp)
    if (!day) continue
    let worktreeId: string | null = null
    let projectKey = 'unscoped'
    let projectLabel = getDefaultProjectLabel(ev.cwd)

    if (ev.cwd) {
      let c = cwdCache.get(ev.cwd)
      if (c === undefined) { c = await canonicalizePath(ev.cwd); cwdCache.set(ev.cwd, c) }
      const wt = findContainingWorktree(c, worktreeLookup, sortedWorktrees)
      if (wt) {
        worktreeId = wt.worktreeId
        projectKey = `worktree:${worktreeId}`
        projectLabel = wt.displayName
      } else {
        projectKey = `cwd:${normalizeComparablePath(ev.cwd)}`
      }
    }
    result.push({ ...ev, day, projectKey, projectLabel, worktreeId })
  }
  return result
}

export function aggregateEvents(events: CodexUsageAttributedEvent[]): {
  sessions: CodexUsageSession[]
  dailyAggregates: CodexUsageDailyAggregate[]
} {
  const sessionsById = new Map<string, CodexUsageSession>()
  const dailyByKey = new Map<string, CodexUsageDailyAggregate>()

  for (const ev of events) {
    let s = sessionsById.get(ev.sessionId)
    if (!s) {
      s = {
        sessionId: ev.sessionId, firstTimestamp: ev.timestamp, lastTimestamp: ev.timestamp,
        model: ev.model, primaryProjectLabel: getDefaultProjectLabel(ev.cwd),
        primaryWorktreeId: ev.worktreeId,
        eventCount: 0, totalInputTokens: 0, totalCachedInputTokens: 0,
        totalOutputTokens: 0, totalReasoningOutputTokens: 0, totalTokens: 0,
        locationBreakdown: [],
      }
      sessionsById.set(ev.sessionId, s)
    }
    if (ev.timestamp < s.firstTimestamp) s.firstTimestamp = ev.timestamp
    if (ev.timestamp > s.lastTimestamp) s.lastTimestamp = ev.timestamp
    s.model = ev.model ?? s.model
    s.eventCount++
    s.totalInputTokens += ev.inputTokens
    s.totalCachedInputTokens += ev.cachedInputTokens
    s.totalOutputTokens += ev.outputTokens
    s.totalReasoningOutputTokens += ev.reasoningOutputTokens
    s.totalTokens += ev.totalTokens

    const loc = s.locationBreakdown.find((l) => l.locationKey === ev.projectKey)
    if (loc) {
      loc.eventCount++
      loc.inputTokens += ev.inputTokens
      loc.cachedInputTokens += ev.cachedInputTokens
      loc.outputTokens += ev.outputTokens
      loc.reasoningOutputTokens += ev.reasoningOutputTokens
      loc.totalTokens += ev.totalTokens
    } else {
      s.locationBreakdown.push({
        locationKey: ev.projectKey, projectLabel: ev.projectLabel,
        worktreeId: ev.worktreeId, eventCount: 1,
        inputTokens: ev.inputTokens, cachedInputTokens: ev.cachedInputTokens,
        outputTokens: ev.outputTokens, reasoningOutputTokens: ev.reasoningOutputTokens,
        totalTokens: ev.totalTokens,
      })
    }

    const dk = [ev.day, ev.model ?? 'unknown', ev.projectKey].join('::')
    const existing = dailyByKey.get(dk)
    if (existing) {
      existing.eventCount++
      existing.inputTokens += ev.inputTokens
      existing.cachedInputTokens += ev.cachedInputTokens
      existing.outputTokens += ev.outputTokens
      existing.reasoningOutputTokens += ev.reasoningOutputTokens
      existing.totalTokens += ev.totalTokens
    } else {
      dailyByKey.set(dk, {
        day: ev.day, model: ev.model, projectKey: ev.projectKey,
        projectLabel: ev.projectLabel, worktreeId: ev.worktreeId,
        eventCount: 1, inputTokens: ev.inputTokens, cachedInputTokens: ev.cachedInputTokens,
        outputTokens: ev.outputTokens, reasoningOutputTokens: ev.reasoningOutputTokens,
        totalTokens: ev.totalTokens,
      })
    }
  }

  for (const s of sessionsById.values()) {
    s.locationBreakdown.sort((a, b) => b.totalTokens - a.totalTokens)
    const primary = s.locationBreakdown[0]
    if (primary) { s.primaryWorktreeId = primary.worktreeId; s.primaryProjectLabel = primary.projectLabel }
  }

  return {
    sessions: [...sessionsById.values()].sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp)),
    dailyAggregates: [...dailyByKey.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }
}

function mergeSession(target: Map<string, CodexUsageSession>, session: CodexUsageSession): void {
  const existing = target.get(session.sessionId)
  if (!existing) {
    target.set(session.sessionId, structuredClone(session))
    return
  }

  if (session.firstTimestamp < existing.firstTimestamp) existing.firstTimestamp = session.firstTimestamp
  if (session.lastTimestamp > existing.lastTimestamp) existing.lastTimestamp = session.lastTimestamp
  existing.model = session.model ?? existing.model
  existing.eventCount += session.eventCount
  existing.totalInputTokens += session.totalInputTokens
  existing.totalCachedInputTokens += session.totalCachedInputTokens
  existing.totalOutputTokens += session.totalOutputTokens
  existing.totalReasoningOutputTokens += session.totalReasoningOutputTokens
  existing.totalTokens += session.totalTokens

  for (const loc of session.locationBreakdown) {
    const existingLoc = existing.locationBreakdown.find((l) => l.locationKey === loc.locationKey)
    if (existingLoc) {
      existingLoc.eventCount += loc.eventCount
      existingLoc.inputTokens += loc.inputTokens
      existingLoc.cachedInputTokens += loc.cachedInputTokens
      existingLoc.outputTokens += loc.outputTokens
      existingLoc.reasoningOutputTokens += loc.reasoningOutputTokens
      existingLoc.totalTokens += loc.totalTokens
    } else {
      existing.locationBreakdown.push({ ...loc })
    }
  }
}

function finalizeSessions(sessionsById: Map<string, CodexUsageSession>): CodexUsageSession[] {
  for (const session of sessionsById.values()) {
    session.locationBreakdown.sort((a, b) => b.totalTokens - a.totalTokens)
    const primary = session.locationBreakdown[0]
    if (primary) {
      session.primaryWorktreeId = primary.worktreeId
      session.primaryProjectLabel = primary.projectLabel
    }
  }

  return [...sessionsById.values()].sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
}

export async function scanCodexUsageFiles(
  worktrees: CodexUsageWorktreeRef[],
  previousFiles: CodexUsagePersistedFile[] = []
): Promise<{
  processedFiles: CodexUsagePersistedFile[]
  sessions: CodexUsageSession[]
  dailyAggregates: CodexUsageDailyAggregate[]
}> {
  const files = await listCodexSessionFiles()
  const prevByPath = new Map(previousFiles.map((f) => [f.path, f]))
  const processedFiles: CodexUsagePersistedFile[] = []
  const worktreeLookup = await buildWorktreeLookup(worktrees)
  const allSessions = new Map<string, CodexUsageSession>()
  const allDaily = new Map<string, CodexUsageDailyAggregate>()

  for (let i = 0; i < files.length; i += FILE_SCAN_BATCH_SIZE) {
    const batch = files.slice(i, i + FILE_SCAN_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (fp) => {
        let fs
        try { fs = await stat(fp) } catch { return null }
        const prev = prevByPath.get(fp)
        if (prev && prev.mtimeMs === fs.mtimeMs && prev.size === fs.size && Array.isArray(prev.sessions)) {
          return prev
        }
        const { processedFile, events } = await parseCodexFile(fp)
        const attributed = await attributeEvents(events, worktreeLookup)
        return { ...processedFile, ...aggregateEvents(attributed) } as CodexUsagePersistedFile
      })
    )
    for (const processed of results) {
      if (!processed) continue
      processedFiles.push(processed)
      for (const s of processed.sessions) {
        mergeSession(allSessions, s)
      }
      for (const d of processed.dailyAggregates) {
        const k = [d.day, d.model ?? 'unknown', d.projectKey].join('::')
        const ex = allDaily.get(k)
        if (!ex) { allDaily.set(k, { ...d }); continue }
        ex.eventCount += d.eventCount
        ex.inputTokens += d.inputTokens
        ex.cachedInputTokens += d.cachedInputTokens
        ex.outputTokens += d.outputTokens
        ex.reasoningOutputTokens += d.reasoningOutputTokens
        ex.totalTokens += d.totalTokens
      }
    }
    if (i + batch.length < files.length) await yieldToEventLoop()
  }

  return {
    processedFiles,
    sessions: finalizeSessions(allSessions),
    dailyAggregates: [...allDaily.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }
}
