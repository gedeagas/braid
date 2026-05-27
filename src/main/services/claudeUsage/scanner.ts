import { homedir } from 'os'
import { join, basename } from 'path'
import { realpath, readdir, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import type {
  ClaudeUsageAttributedTurn,
  ClaudeUsageDailyAggregate,
  ClaudeUsageParsedTurn,
  ClaudeUsagePersistedFile,
  ClaudeUsageProcessedFile,
  ClaudeUsageSession,
  ClaudeUsageWorktreeRef,
} from './types'
import { aggregateTurns, finalizeSessions, mergeSessions, mergeDailyAggregates } from './aggregation'

export { getSessionProjectLabel } from './aggregation'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const CLAUDE_TRANSCRIPTS_DIR = join(homedir(), '.claude', 'transcripts')
const FILE_SCAN_BATCH_SIZE = 4

type SourceRecord = {
  type?: string
  sessionId?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  requestId?: string
  message?: {
    id?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}
type ParsedSourceTurn = ClaudeUsageParsedTurn & { dedupeKey: string | null }

function normalizeComparablePath(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function canonicalizePath(p: string): Promise<string> {
  try {
    return normalizeComparablePath(await realpath(p))
  } catch {
    return normalizeComparablePath(p)
  }
}

function isContainedPath(parent: string, child: string): boolean {
  const p = normalizeComparablePath(parent).replace(/\/+$/, '')
  const c = normalizeComparablePath(child).replace(/\/+$/, '')
  return c === p || c.startsWith(`${p}/`)
}

function getDefaultProjectLabel(cwd: string | null): string {
  if (!cwd) return 'Unknown location'
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join('/')
  return parts.at(-1) ?? cwd
}

function localDayFromTimestamp(ts: string): string | null {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function walkJsonlFiles(dirPath: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkJsonlFiles(fullPath)))
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath)
    }
  }
  return files
}

export async function listClaudeTranscriptFiles(): Promise<string[]> {
  const [projectFiles, transcriptFiles] = await Promise.all([
    walkJsonlFiles(CLAUDE_PROJECTS_DIR),
    walkJsonlFiles(CLAUDE_TRANSCRIPTS_DIR),
  ])
  return [...new Set([...projectFiles, ...transcriptFiles])].sort()
}

function parseSourceRecord(line: string, fallbackSessionId: string | null): ParsedSourceTurn | null {
  let parsed: SourceRecord
  try {
    parsed = JSON.parse(line) as SourceRecord
  } catch {
    return null
  }

  if (parsed.type !== 'assistant') return null
  const sessionId = parsed.sessionId ?? fallbackSessionId
  if (!sessionId || !parsed.timestamp) return null

  const usage = parsed.message?.usage
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0

  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens <= 0) return null

  return {
    sessionId,
    timestamp: parsed.timestamp,
    model: parsed.message?.model ?? null,
    cwd: parsed.cwd ?? null,
    gitBranch: parsed.gitBranch ?? null,
    dedupeKey: parsed.message?.id && parsed.requestId
      ? `${parsed.message.id}:${parsed.requestId}`
      : null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  }
}

function stripSourceMeta(turn: ParsedSourceTurn): ClaudeUsageParsedTurn {
  return {
    sessionId: turn.sessionId,
    timestamp: turn.timestamp,
    model: turn.model,
    cwd: turn.cwd,
    gitBranch: turn.gitBranch,
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
    cacheReadTokens: turn.cacheReadTokens,
    cacheWriteTokens: turn.cacheWriteTokens,
  }
}

function dedupeTurns(turns: ParsedSourceTurn[]): ClaudeUsageParsedTurn[] {
  const dedupeIndex = new Map<string, number>()
  const result: ClaudeUsageParsedTurn[] = []

  for (const turn of turns) {
    if (turn.dedupeKey) {
      const idx = dedupeIndex.get(turn.dedupeKey)
      if (idx !== undefined) {
        const existing = result[idx]
        existing.inputTokens = Math.max(existing.inputTokens, turn.inputTokens)
        existing.outputTokens = Math.max(existing.outputTokens, turn.outputTokens)
        existing.cacheReadTokens = Math.max(existing.cacheReadTokens, turn.cacheReadTokens)
        existing.cacheWriteTokens = Math.max(existing.cacheWriteTokens, turn.cacheWriteTokens)
        continue
      }
    }
    const stripped = stripSourceMeta(turn)
    result.push(stripped)
    if (turn.dedupeKey) dedupeIndex.set(turn.dedupeKey, result.length - 1)
  }

  return result
}

async function readScanFile(filePath: string): Promise<{
  processedFile: ClaudeUsageProcessedFile
  turns: ClaudeUsageParsedTurn[]
}> {
  const fileStat = await stat(filePath)
  let lineCount = 0
  const turns: ParsedSourceTurn[] = []
  const fallbackSessionId = basename(filePath, '.jsonl')
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    lineCount++
    const parsed = parseSourceRecord(line, fallbackSessionId)
    if (parsed) turns.push(parsed)
  }

  return {
    processedFile: {
      path: filePath,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      lineCount,
    },
    turns: dedupeTurns(turns),
  }
}

export async function buildWorktreeLookup(
  worktrees: ClaudeUsageWorktreeRef[]
): Promise<Map<string, ClaudeUsageWorktreeRef>> {
  const lookup = new Map<string, ClaudeUsageWorktreeRef>()
  for (const wt of worktrees) {
    lookup.set(await canonicalizePath(wt.path), wt)
  }
  return lookup
}

function findContainingWorktree(
  cwd: string,
  lookup: Map<string, ClaudeUsageWorktreeRef>
): ClaudeUsageWorktreeRef | null {
  const normalized = normalizeComparablePath(cwd)
  const exact = lookup.get(normalized)
  if (exact) return exact

  const sorted = [...lookup.entries()].sort(
    ([a], [b]) => b.length - a.length
  )
  for (const [worktreePath, wt] of sorted) {
    if (isContainedPath(worktreePath, normalized)) return wt
  }
  return null
}

export async function attributeTurns(
  turns: ClaudeUsageParsedTurn[],
  worktreeLookup: Map<string, ClaudeUsageWorktreeRef>
): Promise<ClaudeUsageAttributedTurn[]> {
  const attributed: ClaudeUsageAttributedTurn[] = []
  const cwdCache = new Map<string, string>()

  for (const turn of turns) {
    const day = localDayFromTimestamp(turn.timestamp)
    if (!day) continue

    let worktreeId: string | null = null
    let projectKey = 'unscoped'
    let projectLabel = getDefaultProjectLabel(turn.cwd)

    if (turn.cwd) {
      let canonical = cwdCache.get(turn.cwd)
      if (canonical === undefined) {
        canonical = await canonicalizePath(turn.cwd)
        cwdCache.set(turn.cwd, canonical)
      }
      const wt = findContainingWorktree(canonical, worktreeLookup)
      if (wt) {
        worktreeId = wt.worktreeId
        projectKey = `worktree:${worktreeId}`
        projectLabel = wt.displayName
      } else {
        projectKey = `cwd:${normalizeComparablePath(turn.cwd)}`
      }
    }

    attributed.push({ ...turn, day, projectKey, projectLabel, worktreeId })
  }

  return attributed
}

async function parsePersistedFile(
  filePath: string,
  worktreeLookup: Map<string, ClaudeUsageWorktreeRef>
): Promise<ClaudeUsagePersistedFile> {
  const { processedFile, turns } = await readScanFile(filePath)
  const attributed = await attributeTurns(turns, worktreeLookup)
  return { ...processedFile, ...aggregateTurns(attributed) }
}

export async function scanClaudeUsageFiles(
  worktrees: ClaudeUsageWorktreeRef[],
  previousFiles: ClaudeUsagePersistedFile[] = []
): Promise<{
  processedFiles: ClaudeUsagePersistedFile[]
  sessions: ClaudeUsageSession[]
  dailyAggregates: ClaudeUsageDailyAggregate[]
}> {
  const files = await listClaudeTranscriptFiles()
  const prevByPath = new Map(previousFiles.map((f) => [f.path, f]))
  const processedFiles: ClaudeUsagePersistedFile[] = []
  const worktreeLookup = await buildWorktreeLookup(worktrees)
  const sessionsById = new Map<string, ClaudeUsageSession>()
  const dailyByKey = new Map<string, ClaudeUsageDailyAggregate>()

  for (let i = 0; i < files.length; i += FILE_SCAN_BATCH_SIZE) {
    const batch = files.slice(i, i + FILE_SCAN_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (filePath) => {
        let fileStat
        try {
          fileStat = await stat(filePath)
        } catch {
          return null
        }
        const prev = prevByPath.get(filePath)
        const canReuse =
          prev &&
          prev.mtimeMs === fileStat.mtimeMs &&
          prev.size === fileStat.size &&
          Array.isArray(prev.sessions) &&
          Array.isArray(prev.dailyAggregates)
        return canReuse ? prev : parsePersistedFile(filePath, worktreeLookup)
      })
    )
    for (const processed of results) {
      if (!processed) continue
      processedFiles.push(processed)
      mergeSessions(sessionsById, processed.sessions)
      mergeDailyAggregates(dailyByKey, processed.dailyAggregates)
    }
    if (i + batch.length < files.length) await yieldToEventLoop()
  }

  return {
    processedFiles,
    sessions: finalizeSessions(sessionsById),
    dailyAggregates: [...dailyByKey.values()].sort((a, b) =>
      a.day === b.day ? a.projectLabel.localeCompare(b.projectLabel) : a.day.localeCompare(b.day)
    ),
  }
}
