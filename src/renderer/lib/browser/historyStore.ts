/**
 * localStorage-backed per-worktree browser history with an in-memory cache.
 * Not a Zustand store: history is only read on demand by the address bar,
 * so no component needs to re-render when it changes.
 */
import { SK } from '@/lib/storageKeys'
import { recordVisit, updateHistoryTitle, type HistoryEntry } from './history'

const cache = new Map<string, HistoryEntry[]>()
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()
const SAVE_DEBOUNCE_MS = 1000

function isEntry(x: unknown): x is HistoryEntry {
  if (typeof x !== 'object' || x === null) return false
  const e = x as Record<string, unknown>
  return typeof e.url === 'string' && typeof e.title === 'string'
    && typeof e.visitCount === 'number' && typeof e.lastVisit === 'number'
}

export function getBrowserHistory(worktreeId: string): HistoryEntry[] {
  const cached = cache.get(worktreeId)
  if (cached) return cached
  let loaded: HistoryEntry[] = []
  try {
    const raw = localStorage.getItem(SK.browserHistoryPrefix + worktreeId)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (Array.isArray(parsed)) loaded = parsed.filter(isEntry)
  } catch {
    // Corrupt entry - start fresh.
  }
  cache.set(worktreeId, loaded)
  return loaded
}

function scheduleSave(worktreeId: string): void {
  const existing = pendingSaves.get(worktreeId)
  if (existing) clearTimeout(existing)
  pendingSaves.set(worktreeId, setTimeout(() => {
    pendingSaves.delete(worktreeId)
    try {
      localStorage.setItem(SK.browserHistoryPrefix + worktreeId, JSON.stringify(cache.get(worktreeId) ?? []))
    } catch {
      // Quota exceeded - history is best effort.
    }
  }, SAVE_DEBOUNCE_MS))
}

function apply(worktreeId: string, fn: (entries: HistoryEntry[]) => HistoryEntry[]): void {
  const before = getBrowserHistory(worktreeId)
  const after = fn(before)
  if (after === before) return
  cache.set(worktreeId, after)
  scheduleSave(worktreeId)
}

export function recordBrowserVisit(worktreeId: string, url: string, title: string): void {
  apply(worktreeId, (entries) => recordVisit(entries, url, title, Date.now()))
}

export function recordBrowserTitle(worktreeId: string, url: string, title: string): void {
  apply(worktreeId, (entries) => updateHistoryTitle(entries, url, title))
}

export function clearBrowserHistory(worktreeId: string): void {
  const pending = pendingSaves.get(worktreeId)
  if (pending) clearTimeout(pending)
  pendingSaves.delete(worktreeId)
  cache.delete(worktreeId)
  try { localStorage.removeItem(SK.browserHistoryPrefix + worktreeId) } catch {}
}
