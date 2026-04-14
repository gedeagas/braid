import { memo, useCallback, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useUIStore } from '@/store/ui'
import { AttentionChips } from './AttentionChips'

/** Derive partition key from URL's root domain so apps on the same domain share auth.
 *  e.g. mail.google.com and meet.google.com → "google.com" → same session */
function getPartitionKey(url: string): string {
  try {
    const hostname = new URL(url).hostname
    const parts = hostname.split('.')
    // Use the last 2 parts (e.g. "google.com"), or 3 for co.uk-style TLDs
    const root = parts.length > 2 && parts[parts.length - 2].length <= 3
      ? parts.slice(-3).join('.')
      : parts.slice(-2).join('.')
    return root
  } catch {
    return url
  }
}

/** Extract notification count from page titles like "(3) Slack" or "* Slack" */
function parseBadgeCount(title: string): number {
  const match = title.match(/^\((\d+)\)/)
  if (match) return parseInt(match[1], 10)
  // Slack uses "* " prefix for unread with no specific count
  if (title.startsWith('* ')) return -1
  return 0
}

const BADGE_POLL_MS = 2000

export const WebAppOverlay = memo(function WebAppOverlay() {
  const embeddedApps = useUIStore(useShallow((s) => s.embeddedApps))
  const activeWebAppId = useUIStore((s) => s.activeWebAppId)
  const dormantAppIds = useUIStore((s) => s.dormantAppIds)
  const setBadge = useUIStore((s) => s.setWebAppBadge)
  const webAppLastUrls = useUIStore((s) => s.webAppLastUrls)
  const setLastUrl = useUIStore((s) => s.setWebAppLastUrl)

  // Only mount webviews for visible + non-dormant apps to save memory
  const mountedApps = embeddedApps.filter((a) => a.visible && !dormantAppIds.has(a.id))

  // Track which webviews already have listeners attached
  const attachedRef = useRef(new Set<string>())
  // Map element → appId so we can clean up when ref is called with null
  const elToAppIdRef = useRef(new Map<HTMLElement, string>())
  // Track polling intervals per app for cleanup
  const intervalsRef = useRef(new Map<string, ReturnType<typeof setInterval>>())

  const webviewRef = useCallback((el: HTMLWebViewElement | null) => {
    // Cleanup: when a webview unmounts, allow re-attach on remount
    if (!el) {
      for (const [prevEl, appId] of elToAppIdRef.current) {
        if (!prevEl.isConnected) {
          attachedRef.current.delete(appId)
          const intervalId = intervalsRef.current.get(appId)
          if (intervalId) {
            clearInterval(intervalId)
            intervalsRef.current.delete(appId)
          }
          elToAppIdRef.current.delete(prevEl)
        }
      }
      return
    }

    const appId = el.dataset.appId
    if (!appId || attachedRef.current.has(appId)) return
    attachedRef.current.add(appId)
    elToAppIdRef.current.set(el, appId)

    const wv = el as HTMLWebViewElement & {
      openDevTools(): void
      getTitle(): string
    }

    // Suppress ERR_ABORTED (-3) from SAML/OAuth redirect chains (e.g. Google
    // ACS → app). Without this, Electron logs GUEST_VIEW_MANAGER_CALL errors
    // because the IPC-layer navigation fails before the main-process
    // did-fail-load handler has a chance to swallow it.
    wv.addEventListener('did-fail-load' as keyof HTMLElementEventMap, ((e: Event & { errorCode?: number }) => {
      if (e.errorCode === -3) return
    }) as EventListener)

    // Auto-open DevTools for webviews in dev mode
    if (import.meta.env.DEV) {
      const onDomReady = (): void => {
        wv.openDevTools()
        wv.removeEventListener('dom-ready' as keyof HTMLElementEventMap, onDomReady as EventListener)
      }
      wv.addEventListener('dom-ready' as keyof HTMLElementEventMap, onDomReady as EventListener)
    }

    // Shared badge state - avoids redundant setBadge calls when both the
    // event listener and the poll interval detect the same title change.
    let lastBadge = -999
    const updateBadge = (title: string): void => {
      const badge = parseBadgeCount(title)
      if (badge !== lastBadge) {
        lastBadge = badge
        setBadge(appId, badge)
      }
    }

    // Fast-path: event-driven badge updates from page title changes
    wv.addEventListener('page-title-updated' as keyof HTMLElementEventMap, ((e: Event & { title?: string }) => {
      updateBadge(e.title ?? '')
    }) as EventListener)

    // Robust fallback: poll getTitle() for SPAs that update document.title via JS
    // without triggering page-title-updated (e.g. Slack, Gmail, Spotify).
    // Uses did-navigate (not dom-ready) so polling restarts after full navigations
    // like OAuth redirects.
    const ensurePolling = (): void => {
      if (intervalsRef.current.has(appId)) return
      const id = setInterval(() => {
        try { updateBadge(wv.getTitle()) }
        catch { /* webview may be destroyed */ }
      }, BADGE_POLL_MS)
      intervalsRef.current.set(appId, id)
    }
    wv.addEventListener('dom-ready' as keyof HTMLElementEventMap, ensurePolling as EventListener)
    wv.addEventListener('did-navigate' as keyof HTMLElementEventMap, ensurePolling as EventListener)

    // Persist last navigated URL so it restores on app restart
    wv.addEventListener('did-navigate' as keyof HTMLElementEventMap, ((e: Event & { url?: string }) => {
      setLastUrl(appId, e.url ?? '')
    }) as EventListener)
  }, [setBadge, setLastUrl])

  // Cleanup all polling intervals on component unmount
  useEffect(() => {
    return () => { for (const id of intervalsRef.current.values()) clearInterval(id) }
  }, [])

  return (
    <div className="web-app-overlay">
      <div className="drag-region drag-region--with-attention">
        <AttentionChips />
      </div>
      {mountedApps.map((app) => (
        <webview
          ref={webviewRef}
          key={app.id}
          data-app-id={app.id}
          src={webAppLastUrls[app.id] ?? app.url}
          partition={`persist:webapp-${getPartitionKey(app.url)}`}
          allowpopups={true}
          style={{
            display: activeWebAppId === app.id ? 'flex' : 'none',
            flex: 1,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
        />
      ))}
    </div>
  )
})
