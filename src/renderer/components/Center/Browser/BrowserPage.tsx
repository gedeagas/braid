import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, type BrowserTab, type PaneId } from '@/store/ui'
import type { SlotRect } from './browserSlots'
import { browserPartitionFor } from '@shared/browser'
import { Button, EmptyState } from '@/components/ui'
import { IconGlobe, IconXCircle } from '@/components/shared/icons'
import {
  BROWSER_FIND_EVENT,
  getBrowserWebview,
  registerBrowserWebview,
  unregisterBrowserWebview,
} from '@/lib/browser/browserCommands'
import type { BrowserWebview } from '@/lib/browser/webviewTypes'
import { BrowserToolbar } from './BrowserToolbar'
import { BrowserFindBar } from './BrowserFindBar'
import { useWebviewEvents, type NavState } from './useWebviewEvents'
import { useBrowserHostShortcuts } from './useBrowserHostShortcuts'
import { useDesignMode, useViewportEmulation } from './useBrowserFeatures'
import { AutomationBanner, DownloadShelf, PermissionBar } from './BrowserPageBars'
import type { BrowserViewport } from '@shared/browser'

// React drops boolean `true` for these non-standard attributes, which silently
// blocks every popup (target=_blank, window.open) and the PDF viewer. Pass strings.
const WEBVIEW_FLAGS = { allowpopups: 'true', plugins: 'true' } as unknown as React.WebViewHTMLAttributes<HTMLWebViewElement>

interface PageState extends NavState {
  findOpen: boolean
  /** Guest webContents id once attached (keys the permission bar / downloads shelf). */
  webContentsId: number | null
}

function reducer(state: PageState, patch: Partial<PageState>): PageState {
  return { ...state, ...patch }
}

interface Props {
  tab: BrowserTab
  worktreeId: string
  /** Pane showing this tab in the selected worktree, or null when hidden. */
  pane: PaneId | null
  /** Where to draw (relative to .center-body); null until the pane's slot is measured. */
  rect: SlotRect | null
}

export const BrowserPage = memo(function BrowserPage({ tab, worktreeId, pane, rect }: Props) {
  const visible = pane !== null && rect !== null
  const { t } = useTranslation('center')
  const [state, patch] = useReducer(reducer, { canGoBack: false, canGoForward: false, error: null, findOpen: false, webContentsId: null })
  const [webview, setWebview] = useState<BrowserWebview | null>(null)
  const loading = useUIStore((s) => Boolean(s.browserLoadingById[tab.id]))
  const viewportRef = useRef<HTMLDivElement>(null)
  const webviewStyle = useViewportEmulation(webview, tab.viewport, viewportRef)
  const design = useDesignMode(tab.id, worktreeId)
  const webContentsId = state.webContentsId

  useEffect(() => {
    if (!webview) return
    // Read straight from the element: listener order vs. the registry binding isn't guaranteed.
    const onReady = () => { try { patch({ webContentsId: webview.getWebContentsId() }) } catch { /* detached */ } }
    webview.addEventListener('dom-ready', onReady)
    return () => webview.removeEventListener('dom-ready', onReady)
  }, [webview])
  const hasUrl = tab.url !== ''

  // The <webview> src is only the *initial* URL. Later navigations go through
  // loadURL - rebinding src on every did-navigate would reload the page.
  const initialSrcRef = useRef<string | null>(null)
  if (hasUrl && initialSrcRef.current === null) initialSrcRef.current = tab.url

  const webviewRef = useCallback((el: HTMLWebViewElement | null) => {
    setWebview(el as BrowserWebview | null)
  }, [])

  useEffect(() => {
    if (!webview) return
    registerBrowserWebview(tab.id, worktreeId, webview)
    return () => unregisterBrowserWebview(tab.id, webview)
  }, [webview, tab.id, worktreeId])

  useWebviewEvents(webview, tab.id, worktreeId, tab.profileId, patch)

  // Clicks inside the guest never reach the host DOM; the webview's focus event does.
  useEffect(() => {
    if (!webview || !pane) return
    const onFocus = () => useUIStore.getState().setFocusedPane(worktreeId, pane)
    webview.addEventListener('focus', onFocus)
    return () => webview.removeEventListener('focus', onFocus)
  }, [webview, pane, worktreeId])
  const focusedPane = useUIStore((s) => s.centerSplitByWorktree[worktreeId]?.focused ?? 'primary')
  useBrowserHostShortcuts(tab.id, visible && focusedPane === pane)

  // ⌘F opens the find bar (the bar itself re-focuses on repeat presses).
  useEffect(() => {
    const onFind = (e: Event) => {
      if ((e as CustomEvent<{ tabId: string }>).detail?.tabId === tab.id) patch({ findOpen: true })
    }
    window.addEventListener(BROWSER_FIND_EVENT, onFind)
    return () => window.removeEventListener(BROWSER_FIND_EVENT, onFind)
  }, [tab.id])

  // Remember the scroll position when the tab is hidden, so a later cold
  // restore (app restart, hibernation) can put it back.
  const wasVisibleRef = useRef(visible)
  useEffect(() => {
    if (wasVisibleRef.current && !visible && webview) {
      webview.executeJavaScript<number>('window.scrollY')
        .then((y) => useUIStore.getState().updateBrowserTab(worktreeId, tab.id, { scrollY: y > 0 ? y : undefined }))
        .catch(() => {})
    }
    if (!wasVisibleRef.current && visible && webview) webview.focus()
    wasVisibleRef.current = visible
  }, [visible, webview, worktreeId, tab.id])

  const navigate = useCallback((url: string) => {
    patch({ error: null })
    const wv = getBrowserWebview(tab.id)
    if (wv) {
      void wv.loadURL(url).catch(() => { /* surfaced via did-fail-load */ })
    } else {
      // First navigation of an empty tab: mounting the webview loads it.
      useUIStore.getState().updateBrowserTab(worktreeId, tab.id, { url })
    }
  }, [tab.id, worktreeId])

  const stop = useCallback(() => {
    try { getBrowserWebview(tab.id)?.stop() } catch { /* not attached */ }
  }, [tab.id])

  const focusPage = useCallback(() => {
    getBrowserWebview(tab.id)?.focus()
  }, [tab.id])

  const changeProfile = useCallback((profileId: string) => {
    // A webview's partition is fixed once attached: the keyed <webview> remounts in the new profile.
    const current = getBrowserWebview(tab.id)
    const url = (() => { try { return current?.getURL() || tab.url } catch { return tab.url } })()
    initialSrcRef.current = url || null
    useUIStore.getState().updateBrowserTab(worktreeId, tab.id, { profileId, url })
  }, [tab.id, tab.url, worktreeId])

  const changeViewport = useCallback((viewport: BrowserViewport | undefined) => {
    useUIStore.getState().updateBrowserTab(worktreeId, tab.id, { viewport })
  }, [tab.id, worktreeId])

  const retry = useCallback(() => {
    const target = state.error?.url || tab.url
    patch({ error: null })
    if (target) navigate(target)
  }, [state.error, tab.url, navigate])

  return (
    <div
      className="browser-page"
      style={visible ? { display: 'flex', left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { display: 'none' }}
      onMouseDownCapture={() => { if (pane) useUIStore.getState().setFocusedPane(worktreeId, pane) }}
    >
      <BrowserToolbar
        tabId={tab.id}
        worktreeId={worktreeId}
        url={tab.url}
        loading={loading}
        canGoBack={state.canGoBack}
        canGoForward={state.canGoForward}
        autoFocusAddress={visible && !hasUrl}
        onNavigate={navigate}
        onStop={stop}
        onFocusPage={focusPage}
        profileId={tab.profileId}
        onProfileChange={changeProfile}
        viewport={tab.viewport}
        onViewportChange={changeViewport}
        designActive={design.active}
        onToggleDesign={design.toggle}
      />
      <AutomationBanner tabId={tab.id} />
      <PermissionBar webContentsId={webContentsId} />
      <DownloadShelf webContentsId={webContentsId} />
      {loading && <div className="browser-progress" aria-label={t('browser.tabLoading')} />}
      <div className={`browser-viewport${tab.viewport ? ' browser-viewport--emulated' : ''}${design.active ? ' browser-viewport--design' : ''}`} ref={viewportRef}>
        {state.findOpen && <BrowserFindBar tabId={tab.id} onClose={() => { patch({ findOpen: false }); focusPage() }} />}
        {hasUrl ? (
          <webview
            key={tab.profileId}
            ref={webviewRef}
            className="browser-webview"
            style={webviewStyle}
            src={initialSrcRef.current ?? tab.url}
            partition={browserPartitionFor(tab.profileId)}
            {...WEBVIEW_FLAGS}
          />
        ) : (
          <EmptyState variant="hero" icon={<IconGlobe size={28} />} title={t('browser.emptyTitle')} hint={t('browser.emptyHint')} />
        )}
        {state.error && (
          <div className="browser-error">
            <EmptyState
              variant="hero"
              icon={<IconXCircle size={28} />}
              title={t('browser.loadFailedTitle')}
              hint={`${state.error.description}${state.error.url ? ` · ${state.error.url}` : ''}`}
              action={<Button variant="primary" onClick={retry}>{t('browser.retry')}</Button>}
            />
          </div>
        )}
      </div>
    </div>
  )
})
