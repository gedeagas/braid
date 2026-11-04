// What main knows about the renderer's browser tabs: per-worktree tab lists
// (pushed on every change) and which tabs have a live guest it can drive.
import { webContents as allWebContents, type WebContents } from 'electron'
import type { BrowserGuestInfo, BrowserTabSummary, BrowserWorktreeSync } from '../../../shared/browser'

interface WorktreeEntry {
  worktreeId: string
  worktreePath: string
  tabs: BrowserTabSummary[]
  activeTabId: string | null
}

const worktrees = new Map<string, WorktreeEntry>()
const guests = new Map<string, BrowserGuestInfo>()
const guestWaiters = new Map<string, Array<(info: BrowserGuestInfo) => void>>()

export function syncWorktree(sync: BrowserWorktreeSync): void {
  worktrees.set(sync.worktreeId, { ...sync })
}

export function registerGuest(info: BrowserGuestInfo): void {
  guests.set(info.tabId, info)
  const waiters = guestWaiters.get(info.tabId)
  if (waiters) {
    guestWaiters.delete(info.tabId)
    for (const resolve of waiters) resolve(info)
  }
}

export function unregisterGuest(tabId: string, webContentsId: number): void {
  if (guests.get(tabId)?.webContentsId === webContentsId) guests.delete(tabId)
}

export function getGuest(tabId: string): BrowserGuestInfo | null {
  return guests.get(tabId) ?? null
}

export function getGuestByWebContentsId(id: number): BrowserGuestInfo | null {
  for (const info of guests.values()) if (info.webContentsId === id) return info
  return null
}

export function getGuestWebContents(tabId: string): WebContents | null {
  const info = guests.get(tabId)
  if (!info) return null
  const wc = allWebContents.fromId(info.webContentsId)
  return wc && !wc.isDestroyed() ? wc : null
}

export function waitForGuest(tabId: string, timeoutMs: number): Promise<BrowserGuestInfo> {
  const existing = guests.get(tabId)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const list = guestWaiters.get(tabId)?.filter((fn) => fn !== done) ?? []
      if (list.length) guestWaiters.set(tabId, list)
      else guestWaiters.delete(tabId)
      reject(new Error(`Browser tab ${tabId} did not load within ${timeoutMs}ms`))
    }, timeoutMs)
    const done = (info: BrowserGuestInfo) => { clearTimeout(timer); resolve(info) }
    guestWaiters.set(tabId, [...(guestWaiters.get(tabId) ?? []), done])
  })
}

export function getWorktree(worktreeId: string): WorktreeEntry | null {
  return worktrees.get(worktreeId) ?? null
}

/** Worktree containing `cwd` (longest matching path wins, so nested worktrees resolve correctly). */
export function resolveWorktreeByPath(cwd: string): WorktreeEntry | null {
  const normalized = cwd.replace(/\/+$/, '')
  let best: WorktreeEntry | null = null
  for (const entry of worktrees.values()) {
    const root = entry.worktreePath.replace(/\/+$/, '')
    if (!root) continue
    if (normalized === root || normalized.startsWith(root + '/')) {
      if (!best || root.length > best.worktreePath.replace(/\/+$/, '').length) best = entry
    }
  }
  return best
}
