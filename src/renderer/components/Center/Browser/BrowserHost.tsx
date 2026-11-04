import { memo, useEffect, useMemo } from 'react'
import { useUIStore, type BrowserTab, type PaneId } from '@/store/ui'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import * as ipc from '@/lib/ipc'
import { findBrowserTabByWebContentsId, openBrowserTab, runBrowserAction } from '@/lib/browser/browserCommands'
import { BrowserPage } from './BrowserPage'
import { useSlotRects } from './browserSlots'

/** Webviews kept alive (hidden) across tab and worktree switches. Older tabs reload on next visit. */
export const MAX_LIVE_BROWSER_TABS = 6

/** Stable creation order from ids like `bw-<ms>-<n>`, so live pages never move in the DOM. */
function compareTabIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

function useBrowserGuestEvents(): void {
  useEffect(() => {
    const offShortcut = ipc.browser.onShortcut(({ webContentsId, action }) => {
      const target = findBrowserTabByWebContentsId(webContentsId)
      if (target) runBrowserAction(target.tabId, action)
    })
    const offOpenTab = ipc.browser.onOpenTab(({ webContentsId, url, background }) => {
      const opener = findBrowserTabByWebContentsId(webContentsId)
      if (!opener) return
      const profileId = useUIStore.getState().browserTabsByWorktree[opener.worktreeId]
        ?.find((t) => t.id === opener.tabId)?.profileId
      openBrowserTab(opener.worktreeId, { url, profileId, afterKey: `b:${opener.tabId}`, activate: !background })
    })
    return () => { offShortcut(); offOpenTab() }
  }, [])
}

/**
 * Always-mounted overlay holding every live browser tab across all worktrees.
 * A <webview> reloads whenever it is re-parented or detached, so pages are
 * never moved in the DOM: tab switches, worktree switches and moving a tab
 * between split panes only change which page is shown and where.
 */
export const BrowserHost = memo(function BrowserHost() {
  const selectedWorktreeId = useUIStore((s) => s.selectedWorktreeId)
  const tabsByWorktree = useUIStore((s) => s.browserTabsByWorktree)
  const recentIds = useUIStore((s) => s.browserRecentTabIds)
  const touchBrowserTab = useUIStore((s) => s.touchBrowserTab)
  const primaryView = useUIStore((s) => s.activeCenterViewByWorktree[s.selectedWorktreeId ?? ''] ?? null)
  const secondaryView = useUIStore((s) => s.centerSplitByWorktree[s.selectedWorktreeId ?? '']?.secondaryView ?? null)
  const slots = useSlotRects()

  useBrowserGuestEvents()

  // Browser tab shown in each pane of the selected worktree.
  const shown = useMemo(() => {
    const tabs = tabsByWorktree[selectedWorktreeId ?? ''] ?? []
    const out = new Map<string, PaneId>()
    if (primaryView?.type === 'browser' && tabs.some((t) => t.id === primaryView.tabId)) out.set(primaryView.tabId, 'primary')
    if (secondaryView?.type === 'browser' && tabs.some((t) => t.id === secondaryView.tabId)) out.set(secondaryView.tabId, 'secondary')
    return out
  }, [tabsByWorktree, selectedWorktreeId, primaryView, secondaryView])

  useEffect(() => {
    for (const id of shown.keys()) touchBrowserTab(id)
  }, [shown, touchBrowserTab])

  const live = useMemo(() => {
    const byId = new Map<string, { tab: BrowserTab; worktreeId: string }>()
    for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
      for (const tab of tabs) byId.set(tab.id, { tab, worktreeId })
    }
    const keep = new Set(recentIds.filter((id) => byId.has(id)).slice(0, MAX_LIVE_BROWSER_TABS))
    for (const id of shown.keys()) keep.add(id)
    return [...keep].sort(compareTabIds).map((id) => byId.get(id)!)
  }, [tabsByWorktree, recentIds, shown])

  return (
    <div className="browser-host">
      {live.map(({ tab, worktreeId }) => {
        const pane = shown.get(tab.id)
        const rect = pane ? slots[pane] ?? null : null
        return (
          <ErrorBoundary key={tab.id}>
            <BrowserPage tab={tab} worktreeId={worktreeId} pane={pane ?? null} rect={rect} />
          </ErrorBoundary>
        )
      })}
    </div>
  )
})
