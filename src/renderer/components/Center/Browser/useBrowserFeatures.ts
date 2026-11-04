import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { BrowserViewport } from '@shared/browser'
import * as ipc from '@/lib/ipc'
import { getBrowserWebContentsId } from '@/lib/browser/browserCommands'
import { deliverDesignCapture } from '@/lib/browser/designDelivery'
import type { BrowserWebview } from '@/lib/browser/webviewTypes'

/**
 * Viewport emulation: sizes the webview to the emulated viewport (scaled to
 * fit the pane) and keeps CDP device metrics in sync, re-applying after the
 * guest (re)attaches. Returns the style for the <webview>.
 */
export function useViewportEmulation(
  webview: BrowserWebview | null,
  viewport: BrowserViewport | undefined,
  containerRef: RefObject<HTMLDivElement | null>,
): CSSProperties | undefined {
  const [area, setArea] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || !viewport) return
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef, viewport])

  const scale = viewport && area ? Math.min(1, area.w / viewport.width, area.h / viewport.height) : 1

  // Only touch emulation when the user set a viewport, or just removed one -
  // otherwise an agent's browser_set_viewport would be cleared on every load.
  const hadViewportRef = useRef(false)
  useEffect(() => {
    if (!webview) return
    const send = (vp: BrowserViewport | null) => {
      let id: number
      try { id = webview.getWebContentsId() } catch { return /* not attached yet; dom-ready re-runs this */ }
      void ipc.browser.setViewport(id, vp, scale).catch(() => {})
    }
    if (!viewport) {
      if (hadViewportRef.current) send(null)
      hadViewportRef.current = false
      return
    }
    hadViewportRef.current = true
    const apply = () => send(viewport)
    apply()
    webview.addEventListener('dom-ready', apply)
    return () => webview.removeEventListener('dom-ready', apply)
  }, [webview, viewport, scale])

  if (!viewport) return undefined
  return {
    flex: 'none',
    width: Math.floor(viewport.width * scale),
    height: Math.floor(viewport.height * scale),
    margin: 'auto',
    boxShadow: 'var(--shadow-elevation-md)',
  }
}

/**
 * Design Mode: while active, repeatedly lets the user pick an element and
 * hands each pick to the worktree's agent. Esc in the page ends it.
 */
export function useDesignMode(tabId: string, worktreeId: string): { active: boolean; toggle: () => void } {
  const [active, setActive] = useState(false)
  const runRef = useRef(0)

  useEffect(() => {
    if (!active) return
    const run = ++runRef.current
    let cancelled = false
    void (async () => {
      while (!cancelled && runRef.current === run) {
        const id = getBrowserWebContentsId(tabId)
        if (id === null) break
        const capture = await ipc.browser.designPick(id).catch(() => null)
        if (cancelled || runRef.current !== run) break
        if (!capture) { setActive(false); break }
        await deliverDesignCapture(worktreeId, tabId, capture).catch(() => {})
      }
    })()
    return () => {
      cancelled = true
      const id = getBrowserWebContentsId(tabId)
      if (id !== null) void ipc.browser.designCancel(id).catch(() => {})
    }
  }, [active, tabId, worktreeId])

  const toggle = useCallback(() => setActive((v) => !v), [])
  return { active, toggle }
}
