/**
 * Per-worktree browsing history: pure list operations + suggestion ranking.
 * Persistence lives in historyStore.ts.
 */
import { isBrowsableUrl } from '@shared/browser'

export interface HistoryEntry {
  url: string
  title: string
  visitCount: number
  lastVisit: number
}

export const MAX_HISTORY_ENTRIES = 1000
const DAY_MS = 86_400_000

function isRecordable(url: string): boolean {
  return url !== 'about:blank' && isBrowsableUrl(url)
}

/** Record a visit: bump an existing entry (keeping its title when none given) or prepend a new one. */
export function recordVisit(entries: HistoryEntry[], url: string, title: string, now: number): HistoryEntry[] {
  if (!isRecordable(url)) return entries
  const existing = entries.find((e) => e.url === url)
  const updated: HistoryEntry = existing
    ? { url, title: title || existing.title, visitCount: existing.visitCount + 1, lastVisit: now }
    : { url, title, visitCount: 1, lastVisit: now }
  const rest = entries.filter((e) => e.url !== url)
  return [updated, ...rest].slice(0, MAX_HISTORY_ENTRIES)
}

export function updateHistoryTitle(entries: HistoryEntry[], url: string, title: string): HistoryEntry[] {
  const idx = entries.findIndex((e) => e.url === url)
  if (idx === -1 || entries[idx].title === title) return entries
  const next = [...entries]
  next[idx] = { ...next[idx], title }
  return next
}

function stripScheme(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '')
}

/** Subsequence match score in [0, 1]: rewards contiguous runs and early matches. 0 = no match. */
function subsequenceScore(haystack: string, needle: string): number {
  let hi = 0
  let run = 0
  let score = 0
  let firstMatch = -1
  for (const ch of needle) {
    const found = haystack.indexOf(ch, hi)
    if (found === -1) return 0
    if (firstMatch === -1) firstMatch = found
    run = found === hi ? run + 1 : 1
    score += run
    hi = found + 1
  }
  const maxScore = (needle.length * (needle.length + 1)) / 2
  const earliness = 1 - Math.min(firstMatch, 50) / 100
  return (score / maxScore) * earliness
}

function matchScore(entry: HistoryEntry, query: string): number {
  const bare = stripScheme(entry.url).toLowerCase()
  const title = entry.title.toLowerCase()
  if (bare.startsWith(query)) return 4
  if (bare.includes(query)) return 3
  if (title.includes(query)) return 2.5
  // Every whitespace-separated word must appear in url or title.
  const words = query.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((w) => bare.includes(w) || title.includes(w))) return 2
  const fuzzy = Math.max(subsequenceScore(bare, query), subsequenceScore(title, query) * 0.9)
  return fuzzy > 0.3 ? fuzzy : 0
}

function frecency(entry: HistoryEntry, now: number): number {
  const ageDays = Math.max(0, (now - entry.lastVisit) / DAY_MS)
  return Math.log2(1 + entry.visitCount) / (1 + ageDays / 7)
}

/** Rank history for an address bar query. Match quality first, frecency as tiebreaker. */
export function rankSuggestions(entries: HistoryEntry[], rawQuery: string, now: number, limit = 8): HistoryEntry[] {
  const query = rawQuery.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '')
  if (!query) return []
  return entries
    .map((entry) => ({ entry, match: matchScore(entry, query) }))
    .filter((x) => x.match > 0)
    .map((x) => ({ entry: x.entry, score: x.match * 10 + frecency(x.entry, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.entry)
}
