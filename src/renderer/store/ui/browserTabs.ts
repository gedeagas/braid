import { type StateCreator } from 'zustand'
import type { UIState } from './types'
import type { CenterView } from './layout'
import { DEFAULT_BROWSER_PROFILE_ID } from '@shared/browser'
import { persistActiveView } from './terminalsPersistence'
import {
  type BrowserTab,
  loadAllBrowserTabs,
  saveBrowserTabsFor,
  removeBrowserTabsFor,
} from './browserTabsPersistence'

export type { BrowserTab } from './browserTabsPersistence'

export const MAX_CLOSED_BROWSER_TABS = 20
const MAX_RECENT_IDS = 50

interface ClosedBrowserTab {
  tab: BrowserTab
  index: number
}

let _bwCounter = 0
function nextBrowserTabId(): string {
  _bwCounter++
  return `bw-${Date.now()}-${_bwCounter}`
}

// Same rule as big terminals: when the closed tab was active, move to the
// adjacent browser tab (clamped), or null when none remain.
function nextViewAfterClose(
  view: CenterView | null | undefined,
  closedId: string,
  remaining: BrowserTab[],
  closedIndex: number,
): CenterView | null | undefined {
  if (!(view?.type === 'browser' && view.tabId === closedId)) return undefined
  if (remaining.length === 0) return null
  const idx = Math.min(Math.max(closedIndex, 0), remaining.length - 1)
  return { type: 'browser', tabId: remaining[idx].id }
}

function samePatch(tab: BrowserTab, patch: Partial<BrowserTab>): boolean {
  return (Object.keys(patch) as Array<keyof BrowserTab>).every((k) => tab[k] === patch[k])
}

export interface BrowserTabsSlice {
  browserTabsByWorktree: Record<string, BrowserTab[]>
  /** Recently closed tabs per worktree (in memory only), most recent last. */
  closedBrowserTabsByWorktree: Record<string, ClosedBrowserTab[]>
  /** Most recently used browser tab ids across all worktrees, most recent first. Drives webview keep-alive. */
  browserRecentTabIds: string[]
  /** Tabs whose page is currently loading (in memory only). */
  browserLoadingById: Record<string, boolean>
  setBrowserTabLoading: (id: string, loading: boolean) => void
  createBrowserTab: (worktreeId: string, opts?: { url?: string; profileId?: string }) => string
  updateBrowserTab: (worktreeId: string, id: string, patch: Partial<Omit<BrowserTab, 'id'>>) => void
  closeBrowserTab: (worktreeId: string, id: string) => void
  /** Restore the most recently closed tab. Returns its id, or null when the stack is empty. */
  reopenClosedBrowserTab: (worktreeId: string) => string | null
  /** Mark a tab as just used (keeps its webview alive). */
  touchBrowserTab: (id: string) => void
  clearBrowserTabsForWorktree: (worktreeId: string) => void
}

export const createBrowserTabsSlice: StateCreator<UIState, [], [], BrowserTabsSlice> = (set) => ({
  browserTabsByWorktree: loadAllBrowserTabs(),
  closedBrowserTabsByWorktree: {},
  browserRecentTabIds: [],
  browserLoadingById: {},

  setBrowserTabLoading: (id, loading) => {
    set((s) => {
      if (Boolean(s.browserLoadingById[id]) === loading) return s
      const next = { ...s.browserLoadingById }
      if (loading) next[id] = true
      else delete next[id]
      return { browserLoadingById: next }
    })
  },

  createBrowserTab: (worktreeId, opts) => {
    const id = nextBrowserTabId()
    set((s) => {
      const tab: BrowserTab = { id, url: opts?.url ?? '', title: '', profileId: opts?.profileId ?? DEFAULT_BROWSER_PROFILE_ID }
      const next = [...(s.browserTabsByWorktree[worktreeId] ?? []), tab]
      saveBrowserTabsFor(worktreeId, next)
      return { browserTabsByWorktree: { ...s.browserTabsByWorktree, [worktreeId]: next } }
    })
    return id
  },

  updateBrowserTab: (worktreeId, id, patch) => {
    set((s) => {
      const existing = s.browserTabsByWorktree[worktreeId]
      const idx = existing?.findIndex((t) => t.id === id) ?? -1
      if (!existing || idx === -1 || samePatch(existing[idx], patch)) return s
      const next = [...existing]
      next[idx] = { ...next[idx], ...patch }
      saveBrowserTabsFor(worktreeId, next)
      return { browserTabsByWorktree: { ...s.browserTabsByWorktree, [worktreeId]: next } }
    })
  },

  closeBrowserTab: (worktreeId, id) => {
    set((s) => {
      const existing = s.browserTabsByWorktree[worktreeId] ?? []
      const closedIndex = existing.findIndex((t) => t.id === id)
      if (closedIndex === -1) return s
      const next = existing.filter((t) => t.id !== id)
      saveBrowserTabsFor(worktreeId, next)
      const closed = [...(s.closedBrowserTabsByWorktree[worktreeId] ?? []), { tab: existing[closedIndex], index: closedIndex }]
        .slice(-MAX_CLOSED_BROWSER_TABS)
      const nextView = nextViewAfterClose(s.activeCenterViewByWorktree?.[worktreeId], id, next, closedIndex)
      const viewUpdate = nextView === undefined ? {} : (() => {
        persistActiveView(worktreeId, nextView)
        return { activeCenterViewByWorktree: { ...s.activeCenterViewByWorktree, [worktreeId]: nextView } }
      })()
      return {
        browserTabsByWorktree: { ...s.browserTabsByWorktree, [worktreeId]: next },
        closedBrowserTabsByWorktree: { ...s.closedBrowserTabsByWorktree, [worktreeId]: closed },
        browserRecentTabIds: s.browserRecentTabIds.filter((x) => x !== id),
        browserLoadingById: (() => { const n = { ...s.browserLoadingById }; delete n[id]; return n })(),
        ...viewUpdate,
      }
    })
  },

  reopenClosedBrowserTab: (worktreeId) => {
    let reopened: string | null = null
    set((s) => {
      const stack = s.closedBrowserTabsByWorktree[worktreeId] ?? []
      const last = stack.at(-1)
      if (!last) return s
      reopened = last.tab.id
      const existing = [...(s.browserTabsByWorktree[worktreeId] ?? [])]
      existing.splice(Math.min(last.index, existing.length), 0, last.tab)
      saveBrowserTabsFor(worktreeId, existing)
      return {
        browserTabsByWorktree: { ...s.browserTabsByWorktree, [worktreeId]: existing },
        closedBrowserTabsByWorktree: { ...s.closedBrowserTabsByWorktree, [worktreeId]: stack.slice(0, -1) },
      }
    })
    return reopened
  },

  touchBrowserTab: (id) => {
    set((s) => {
      if (s.browserRecentTabIds[0] === id) return s
      return { browserRecentTabIds: [id, ...s.browserRecentTabIds.filter((x) => x !== id)].slice(0, MAX_RECENT_IDS) }
    })
  },

  clearBrowserTabsForWorktree: (worktreeId) => {
    removeBrowserTabsFor(worktreeId)
    set((s) => {
      const ids = new Set((s.browserTabsByWorktree[worktreeId] ?? []).map((t) => t.id))
      const tabs = { ...s.browserTabsByWorktree }
      delete tabs[worktreeId]
      const closed = { ...s.closedBrowserTabsByWorktree }
      delete closed[worktreeId]
      return {
        browserTabsByWorktree: tabs,
        closedBrowserTabsByWorktree: closed,
        browserRecentTabIds: s.browserRecentTabIds.filter((x) => !ids.has(x)),
      }
    })
  },
})
