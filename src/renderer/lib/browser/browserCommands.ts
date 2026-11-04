/**
 * Imperative browser tab commands shared by the tab bar, menu accelerators,
 * guest-forwarded shortcuts and the command palette. Reads fresh store state
 * on every call (no captured snapshots).
 */
import type { BrowserWebview } from './webviewTypes'
import { DEFAULT_BROWSER_PROFILE_ID, type BrowserShortcutAction } from '@shared/browser'
import { useUIStore, type PaneId } from '@/store/ui'
import { getFocusedView, placeTabInPane } from '@/lib/centerPanes'

// ─── Webview registry ────────────────────────────────────────────────────────

interface RegisteredWebview {
  worktreeId: string
  el: BrowserWebview
  webContentsId: number | null
}

const webviews = new Map<string, RegisteredWebview>()

export function registerBrowserWebview(tabId: string, worktreeId: string, el: BrowserWebview): void {
  webviews.set(tabId, { worktreeId, el, webContentsId: null })
}

/** Called once the guest is attached (dom-ready); getWebContentsId throws before that. */
export function bindBrowserWebContentsId(tabId: string): void {
  const entry = webviews.get(tabId)
  if (!entry) return
  try { entry.webContentsId = entry.el.getWebContentsId() } catch { /* not attached yet */ }
}

export function unregisterBrowserWebview(tabId: string, el: BrowserWebview): void {
  if (webviews.get(tabId)?.el === el) webviews.delete(tabId)
}

export function getBrowserWebContentsId(tabId: string): number | null {
  return webviews.get(tabId)?.webContentsId ?? null
}

export function getBrowserWebview(tabId: string): BrowserWebview | null {
  return webviews.get(tabId)?.el ?? null
}

export function findBrowserTabByWebContentsId(webContentsId: number): { tabId: string; worktreeId: string } | null {
  for (const [tabId, entry] of webviews) {
    if (entry.webContentsId === webContentsId) return { tabId, worktreeId: entry.worktreeId }
  }
  return null
}

// ─── Tab lifecycle ───────────────────────────────────────────────────────────

/** Active browser tab id in the selected worktree, or null when the center shows something else. */
export function getActiveBrowserTabId(): string | null {
  const view = getFocusedView()
  return view?.type === 'browser' ? view.tabId : null
}

function insertAfter(worktreeId: string, newKey: string, afterKey: string | undefined): void {
  const ui = useUIStore.getState()
  if (!afterKey || ui.selectedWorktreeId !== worktreeId) return
  const order = ui.tabOrder.filter((k) => k !== newKey)
  const idx = order.indexOf(afterKey)
  if (idx === -1) return
  order.splice(idx + 1, 0, newKey)
  ui.setTabOrder(order)
}

export interface OpenBrowserTabOptions {
  url?: string
  profileId?: string
  /** Tab key to place the new tab after (defaults to the end). */
  afterKey?: string
  /** Switch the center view to the new tab (default true). */
  activate?: boolean
  /** Pane to show it in when activating (default: the focused pane). */
  pane?: PaneId
}

export function openBrowserTab(worktreeId: string, opts: OpenBrowserTabOptions = {}): string {
  const ui = useUIStore.getState()
  const id = ui.createBrowserTab(worktreeId, { url: opts.url, profileId: opts.profileId })
  insertAfter(worktreeId, `b:${id}`, opts.afterKey)
  if (opts.activate !== false && ui.selectedWorktreeId === worktreeId) {
    placeTabInPane(worktreeId, `b:${id}`, opts.pane ?? null)
    ui.touchBrowserTab(id)
  }
  return id
}

/** New empty tab in the selected worktree, placed after the active browser tab when there is one. */
export function newBrowserTab(): string | null {
  const ui = useUIStore.getState()
  if (!ui.selectedWorktreeId) return null
  const activeId = getActiveBrowserTabId()
  const profileId = activeId
    ? ui.browserTabsByWorktree[ui.selectedWorktreeId]?.find((t) => t.id === activeId)?.profileId
    : undefined
  return openBrowserTab(ui.selectedWorktreeId, { afterKey: activeId ? `b:${activeId}` : undefined, profileId })
}

export function reopenClosedBrowserTab(): string | null {
  const ui = useUIStore.getState()
  if (!ui.selectedWorktreeId) return null
  const id = ui.reopenClosedBrowserTab(ui.selectedWorktreeId)
  if (id) {
    placeTabInPane(ui.selectedWorktreeId, `b:${id}`, null)
    ui.touchBrowserTab(id)
  }
  return id
}

export function closeBrowserTab(worktreeId: string, tabId: string): void {
  useUIStore.getState().closeBrowserTab(worktreeId, tabId)
}

/** Move every tab using `profileId` to the default profile (their pages reload there). */
export function moveProfileTabsToDefault(profileId: string): void {
  const ui = useUIStore.getState()
  for (const [worktreeId, tabs] of Object.entries(ui.browserTabsByWorktree)) {
    for (const tab of tabs) {
      if (tab.profileId === profileId) ui.updateBrowserTab(worktreeId, tab.id, { profileId: DEFAULT_BROWSER_PROFILE_ID })
    }
  }
}

// ─── In-page actions ─────────────────────────────────────────────────────────

/** Window events BrowserPage listens for (UI-only actions that need component state). */
export const BROWSER_FIND_EVENT = 'braid:browserFind'
export const BROWSER_FOCUS_ADDRESS_EVENT = 'braid:browserFocusAddress'

function dispatchTabEvent(name: string, tabId: string): void {
  window.dispatchEvent(new CustomEvent(name, { detail: { tabId } }))
}

export function runBrowserAction(tabId: string, action: BrowserShortcutAction): void {
  if (action === 'newTab') { newBrowserTab(); return }
  if (action === 'reopenClosedTab') { reopenClosedBrowserTab(); return }
  if (action === 'find') { dispatchTabEvent(BROWSER_FIND_EVENT, tabId); return }
  if (action === 'focusAddress') { dispatchTabEvent(BROWSER_FOCUS_ADDRESS_EVENT, tabId); return }
  if (action === 'closeTab') {
    const worktreeId = webviews.get(tabId)?.worktreeId ?? useUIStore.getState().selectedWorktreeId
    if (worktreeId) closeBrowserTab(worktreeId, tabId)
    return
  }
  const wv = getBrowserWebview(tabId)
  if (!wv) return
  try {
    if (action === 'reload') wv.reload()
    else if (action === 'hardReload') wv.reloadIgnoringCache()
    else if (action === 'back' && wv.canGoBack()) wv.goBack()
    else if (action === 'forward' && wv.canGoForward()) wv.goForward()
    else if (action === 'devtools') {
      if (wv.isDevToolsOpened()) wv.closeDevTools()
      else wv.openDevTools()
    }
  } catch {
    // Guest not attached yet - nothing to act on.
  }
}
