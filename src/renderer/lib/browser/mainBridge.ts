/**
 * Keeps main informed about browser tabs (for agent automation) and serves
 * main's tab lifecycle requests. Started once by BrowserHost.
 */
import type { BrowserRendererRequest, BrowserTabSummary, BrowserWorktreeSync } from '@shared/browser'
import { useUIStore, type BrowserTab } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { useBrowserStore } from '@/store/browser'
import * as ipc from '@/lib/ipc'
import { getBrowserWebview, openBrowserTab } from './browserCommands'
import { openLink } from './linkRouter'
import { startAgentTabTracking } from './designDelivery'

function worktreePathOf(worktreeId: string): string {
  for (const p of useProjectsStore.getState().projects) {
    const wt = p.worktrees.find((w) => w.id === worktreeId)
    if (wt) return wt.path
  }
  return ''
}

/** Active browser tab of a worktree: the one on screen, else its most recently used tab. */
export function activeBrowserTabFor(tabs: BrowserTab[], recent: string[], viewTabId: string | null): string | null {
  if (viewTabId && tabs.some((t) => t.id === viewTabId)) return viewTabId
  return recent.find((id) => tabs.some((t) => t.id === id)) ?? tabs[0]?.id ?? null
}

const lastSent = new Map<string, string>()

function pushSyncs(): void {
  const ui = useUIStore.getState()
  for (const [worktreeId, tabs] of Object.entries(ui.browserTabsByWorktree)) {
    const view = ui.activeCenterViewByWorktree[worktreeId]
    const summaries: BrowserTabSummary[] = tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, profileId: t.profileId }))
    const sync: BrowserWorktreeSync = {
      worktreeId,
      worktreePath: worktreePathOf(worktreeId),
      tabs: summaries,
      activeTabId: activeBrowserTabFor(tabs, ui.browserRecentTabIds, view?.type === 'browser' ? view.tabId : null),
    }
    const key = JSON.stringify(sync)
    if (lastSent.get(worktreeId) === key) continue
    lastSent.set(worktreeId, key)
    void ipc.browser.syncWorktree(sync).catch(() => {})
  }
}

async function handleRequest(request: BrowserRendererRequest): Promise<unknown> {
  const ui = useUIStore.getState()
  switch (request.type) {
    case 'openTab': {
      const tabId = openBrowserTab(request.worktreeId, { url: request.url, activate: request.activate && ui.selectedWorktreeId === request.worktreeId })
      // Background tabs still need a live page for the agent.
      useUIStore.getState().touchBrowserTab(tabId)
      if (!request.activate) useUIStore.getState().touchBrowserTab(getVisibleBrowserTab() ?? tabId)
      return { tabId }
    }
    case 'activateTab': {
      if (ui.selectedWorktreeId === request.worktreeId) ui.setActiveCenterView({ type: 'browser', tabId: request.tabId })
      ui.touchBrowserTab(request.tabId)
      return { ok: true }
    }
    case 'closeTab':
      ui.closeBrowserTab(request.worktreeId, request.tabId)
      return { ok: true }
    case 'wakeTab': {
      ui.touchBrowserTab(request.tabId)
      // Keep the user's visible tab first in the keep-alive order.
      const visible = getVisibleBrowserTab()
      if (visible && visible !== request.tabId) ui.touchBrowserTab(visible)
      return { ok: true }
    }
    case 'focusTab':
      getBrowserWebview(request.tabId)?.focus()
      return { ok: true }
    case 'navigateTab':
      ui.updateBrowserTab(request.worktreeId, request.tabId, { url: request.url })
      ui.touchBrowserTab(request.tabId)
      return { ok: true }
  }
}

function getVisibleBrowserTab(): string | null {
  const ui = useUIStore.getState()
  const view = ui.activeCenterViewByWorktree[ui.selectedWorktreeId ?? ''] ?? null
  return view?.type === 'browser' ? view.tabId : null
}

let started = false

export function startBrowserMainBridge(): () => void {
  if (started) return () => {}
  started = true
  void useBrowserStore.getState().loadSettings()
  pushSyncs()
  const unsubUi = useUIStore.subscribe((s, prev) => {
    if (s.browserTabsByWorktree !== prev.browserTabsByWorktree
      || s.activeCenterViewByWorktree !== prev.activeCenterViewByWorktree
      || s.browserRecentTabIds !== prev.browserRecentTabIds) pushSyncs()
  })
  const unsubProjects = useProjectsStore.subscribe((s, prev) => { if (s.projects !== prev.projects) pushSyncs() })
  const offRequest = ipc.browser.onRequest(({ id, request }) => {
    handleRequest(request)
      .then((payload) => ipc.browser.respond(id, true, payload))
      .catch((err: unknown) => ipc.browser.respond(id, false, err instanceof Error ? err.message : String(err)))
  })
  const offDownload = ipc.browser.onDownload((d) => useBrowserStore.getState().upsertDownload(d))
  const offPermission = ipc.browser.onPermissionRequest((r) => useBrowserStore.getState().addPermissionRequest(r))
  const offRouteLink = ipc.browser.onRouteLink((url) => openLink(url))
  const offAutomation = ipc.browser.onAutomationActivity((tabId) => useBrowserStore.getState().noteAutomation(tabId))
  const stopAgentTracking = startAgentTabTracking()
  return () => {
    started = false
    unsubUi(); unsubProjects(); offRequest(); offDownload(); offPermission(); offRouteLink(); offAutomation(); stopAgentTracking()
  }
}
