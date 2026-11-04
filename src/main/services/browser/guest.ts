// Per-guest wiring for browser tabs: popups, forwarded shortcuts, context menu
// and navigation guards. Runs on `did-attach-webview` for browser partitions.
import { Menu, clipboard, shell, type WebContents, type MenuItemConstructorOptions } from 'electron'
import { isBrowsableUrl, type BrowserOpenTabEvent, type BrowserShortcutEvent } from '../../../shared/browser'
import { browserShortcutFor } from './shortcuts'
import { decidePopup } from './popups'

const POPUP_WIDTH = 520
const POPUP_HEIGHT = 720
const EXTERNAL_NAVIGATION = /^(mailto|tel|sms|facetime):/i

function sendToHost(guest: WebContents, channel: string, payload: unknown): void {
  const host = guest.hostWebContents
  if (host && !host.isDestroyed()) host.send(channel, payload)
}

function openTab(guest: WebContents, url: string, background: boolean): void {
  const payload: BrowserOpenTabEvent = { webContentsId: guest.id, url, background }
  sendToHost(guest, 'browser:openTab', payload)
}

function wirePopups(guest: WebContents): void {
  guest.setWindowOpenHandler((details) => {
    const decision = decidePopup(details)
    if (decision.kind === 'tab') {
      openTab(guest, details.url, decision.background)
      return { action: 'deny' }
    }
    if (decision.kind === 'external') {
      void shell.openExternal(details.url)
      return { action: 'deny' }
    }
    if (decision.kind === 'window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: POPUP_WIDTH,
          height: POPUP_HEIGHT,
          autoHideMenuBar: true,
          webPreferences: {
            session: guest.session,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        },
      }
    }
    return { action: 'deny' }
  })

  // Popup windows get the same guards (their own popups become tabs of the opener).
  guest.on('did-create-window', (win) => {
    win.webContents.setWindowOpenHandler((details) => {
      const decision = decidePopup(details)
      if (decision.kind === 'tab') openTab(guest, details.url, decision.background)
      else if (decision.kind === 'external') void shell.openExternal(details.url)
      return { action: 'deny' }
    })
    guardNavigation(win.webContents)
  })
}

function guardNavigation(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isBrowsableUrl(url)) return
    event.preventDefault()
    if (EXTERNAL_NAVIGATION.test(url)) void shell.openExternal(url)
  })
  contents.on('will-redirect', (event, url) => {
    if (!isBrowsableUrl(url)) event.preventDefault()
  })
}

function wireShortcuts(guest: WebContents): void {
  guest.on('before-input-event', (event, input) => {
    const action = browserShortcutFor(input)
    if (!action) return
    // Also suppresses the app-menu accelerator, so the action never runs twice.
    event.preventDefault()
    const payload: BrowserShortcutEvent = { webContentsId: guest.id, action }
    sendToHost(guest, 'browser:shortcut', payload)
  })
}

function wireContextMenu(guest: WebContents): void {
  guest.on('context-menu', (_e, params) => {
    const nav = guest.navigationHistory
    const items: MenuItemConstructorOptions[] = []

    if (params.linkURL) {
      items.push(
        { label: 'Open Link in New Tab', enabled: isBrowsableUrl(params.linkURL), click: () => openTab(guest, params.linkURL, false) },
        { label: 'Open Link in System Browser', click: () => { void shell.openExternal(params.linkURL) } },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      )
    }
    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        { label: 'Open Image in New Tab', enabled: isBrowsableUrl(params.srcURL), click: () => openTab(guest, params.srcURL, false) },
        { label: 'Copy Image', click: () => guest.copyImageAt(params.x, params.y) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
        { type: 'separator' },
      )
    }
    if (params.isEditable) {
      items.push(
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Select All', role: 'selectAll' },
        { type: 'separator' },
      )
    } else if (params.selectionText) {
      items.push({ label: 'Copy', role: 'copy' }, { type: 'separator' })
    }
    if (!params.linkURL && !params.isEditable && !params.selectionText) {
      items.push(
        { label: 'Back', enabled: nav.canGoBack(), click: () => nav.goBack() },
        { label: 'Forward', enabled: nav.canGoForward(), click: () => nav.goForward() },
        { label: 'Reload', click: () => guest.reload() },
        { type: 'separator' },
      )
    }
    items.push({ label: 'Inspect Element', click: () => guest.inspectElement(params.x, params.y) })

    Menu.buildFromTemplate(items).popup()
  })
}

/** Wire a freshly attached browser guest. */
export function attachBrowserGuest(guest: WebContents): void {
  wirePopups(guest)
  guardNavigation(guest)
  wireShortcuts(guest)
  wireContextMenu(guest)
}
