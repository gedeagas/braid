import { useEffect, useRef } from 'react'
import { useUIStore } from '@/store/ui'
import * as ipc from '@/lib/ipc'
import { bindBrowserWebContentsId } from '@/lib/browser/browserCommands'
import { recordBrowserTitle, recordBrowserVisit } from '@/lib/browser/historyStore'
import type {
  BrowserWebview,
  WebviewFailLoadEvent,
  WebviewFaviconEvent,
  WebviewNavigateEvent,
  WebviewTitleEvent,
} from '@/lib/browser/webviewTypes'

export interface NavState {
  canGoBack: boolean
  canGoForward: boolean
  error: { description: string; url: string } | null
}

/** Chromium net error codes that aren't user-visible failures. */
const BENIGN_ERRORS = new Set([-3 /* ERR_ABORTED */])

/**
 * Wire a browser tab's <webview> DOM events into the store and history.
 * `webview` is null until the tab has a URL to load.
 */
export function useWebviewEvents(
  webview: BrowserWebview | null,
  tabId: string,
  worktreeId: string,
  profileId: string,
  onNavState: (s: Partial<NavState>) => void,
): void {
  // Latest-callback ref so the effect doesn't re-subscribe on every render.
  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState

  useEffect(() => {
    if (!webview) return
    const ui = () => useUIStore.getState()
    let restoredScroll = false
    let registeredId: number | null = null

    const refreshNav = () => {
      try {
        onNavStateRef.current({ canGoBack: webview.canGoBack(), canGoForward: webview.canGoForward() })
      } catch { /* not attached */ }
    }

    const onDomReady = () => {
      bindBrowserWebContentsId(tabId)
      try {
        const webContentsId = webview.getWebContentsId()
        if (registeredId !== webContentsId) {
          registeredId = webContentsId
          void ipc.browser.registerGuest({ tabId, worktreeId, webContentsId, profileId }).catch(() => {})
        }
      } catch { /* not attached */ }
      refreshNav()
    }
    const onStartLoading = () => ui().setBrowserTabLoading(tabId, true)
    const onStopLoading = () => {
      ui().setBrowserTabLoading(tabId, false)
      refreshNav()
    }
    const onNavigate = (e: Event) => {
      const { url } = e as WebviewNavigateEvent
      ui().updateBrowserTab(worktreeId, tabId, { url })
      recordBrowserVisit(worktreeId, url, '')
      onNavStateRef.current({ error: null })
      refreshNav()
    }
    const onNavigateInPage = (e: Event) => {
      const { url, isMainFrame } = e as WebviewNavigateEvent
      if (isMainFrame === false) return
      ui().updateBrowserTab(worktreeId, tabId, { url })
      recordBrowserVisit(worktreeId, url, '')
      refreshNav()
    }
    const onTitle = (e: Event) => {
      const { title } = e as WebviewTitleEvent
      ui().updateBrowserTab(worktreeId, tabId, { title })
      try { recordBrowserTitle(worktreeId, webview.getURL(), title) } catch { /* not attached */ }
    }
    const onFavicon = (e: Event) => {
      const favicon = (e as WebviewFaviconEvent).favicons[0]
      if (favicon) ui().updateBrowserTab(worktreeId, tabId, { faviconUrl: favicon })
    }
    const onFailLoad = (e: Event) => {
      const { errorCode, errorDescription, validatedURL, isMainFrame } = e as WebviewFailLoadEvent
      if (!isMainFrame || BENIGN_ERRORS.has(errorCode)) return
      onNavStateRef.current({ error: { description: errorDescription || String(errorCode), url: validatedURL } })
    }
    const onFinishLoad = () => {
      // After a cold start / hibernation, put the page back where the user left it.
      if (restoredScroll) return
      restoredScroll = true
      const tab = ui().browserTabsByWorktree[worktreeId]?.find((t) => t.id === tabId)
      if (!tab?.scrollY) return
      void webview.executeJavaScript(`window.scrollTo(0, ${Math.round(tab.scrollY)})`).catch(() => {})
      ui().updateBrowserTab(worktreeId, tabId, { scrollY: undefined })
    }

    const listeners: Array<[string, (e: Event) => void]> = [
      ['dom-ready', onDomReady],
      ['did-start-loading', onStartLoading],
      ['did-stop-loading', onStopLoading],
      ['did-navigate', onNavigate],
      ['did-navigate-in-page', onNavigateInPage],
      ['page-title-updated', onTitle],
      ['page-favicon-updated', onFavicon],
      ['did-fail-load', onFailLoad],
      ['did-finish-load', onFinishLoad],
    ]
    for (const [name, fn] of listeners) webview.addEventListener(name, fn)
    return () => {
      for (const [name, fn] of listeners) webview.removeEventListener(name, fn)
      ui().setBrowserTabLoading(tabId, false)
      if (registeredId !== null) void ipc.browser.unregisterGuest(tabId, registeredId).catch(() => {})
    }
  }, [webview, tabId, worktreeId, profileId])
}
