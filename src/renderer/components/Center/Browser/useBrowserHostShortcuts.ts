import { useEffect } from 'react'
import type { BrowserShortcutAction } from '@shared/browser'
import { runBrowserAction } from '@/lib/browser/browserCommands'
import * as ipc from '@/lib/ipc'

/**
 * Browser shortcuts while focus is in Braid's own UI (toolbar, address bar,
 * find bar). When focus is inside the page, main forwards them instead.
 * ⌘T / ⌘⇧T / ⌘L / ⌘W are app-menu accelerators and are routed in appActions.
 */
function actionFor(e: KeyboardEvent): BrowserShortcutAction | null {
  const isMac = ipc.shell.platform === 'darwin'
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod) return null
  if (e.altKey) return !e.shiftKey && e.code === 'KeyI' ? 'devtools' : null
  const key = e.key.toLowerCase()
  if (e.shiftKey) return key === 'r' ? 'hardReload' : null
  if (key === 'f') return 'find'
  if (key === 'r') return 'reload'
  if (key === '[') return 'back'
  if (key === ']') return 'forward'
  return null
}

export function useBrowserHostShortcuts(tabId: string, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent) => {
      // The bottom terminal strip owns its own ⌘F.
      if (e.target instanceof Element && e.target.closest('.xterm')) return
      const action = actionFor(e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      runBrowserAction(tabId, action)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [tabId, active])
}
