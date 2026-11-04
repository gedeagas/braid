// IPC surface for browser tabs (renderer -> main).
import { dialog, ipcMain, session as electronSession, webContents as allWebContents, BrowserWindow, type WebContents } from 'electron'
import {
  browserPartitionFor,
  DEFAULT_BROWSER_PROFILE_ID,
  type BrowserGuestInfo,
  type BrowserSettings,
  type BrowserViewport,
  type BrowserWorktreeSync,
  type DesignModeCapture,
} from '../../../shared/browser'
import { registerGuest, syncWorktree, unregisterGuest } from './registry'
import { getBrowserSettings, setBrowserSettings } from './settings'
import { getBrowserSession, isBrowserSession } from './session'
import { setViewport } from './viewport'
import { cancelPick, pickElement, saveCapture } from './designMode'
import { importChromiumCookies, importCookieFile, listChromiumProfiles, type ChromiumBrowser } from './cookies'
import { registerRendererRequestHandlers } from './rendererRequests'
import { registerPermissionHandlers } from './permissions'
import { registerDownloadHandlers } from './downloads'
import { getAgentBridgeStatus, syncAgentBrowserBridge } from './agentBridge/install'

/** Only act on browser-tab guests (never the app window or other webviews). */
function guestContents(webContentsId: number): WebContents {
  const wc = allWebContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) throw new Error('Browser tab is gone')
  if (wc.getType() !== 'webview' || !isBrowserSession(wc.session)) throw new Error('Not a browser tab')
  return wc
}

function profileSession(profileId: string) {
  if (!getBrowserSettings().profiles.some((p) => p.id === profileId)) throw new Error(`Unknown browser profile ${profileId}`)
  return getBrowserSession(browserPartitionFor(profileId))
}

export function registerBrowserIpc(): void {
  registerRendererRequestHandlers()
  registerPermissionHandlers()
  registerDownloadHandlers()

  ipcMain.handle('browser:registerGuest', (_e, info: BrowserGuestInfo) => registerGuest(info))
  ipcMain.handle('browser:unregisterGuest', (_e, tabId: string, webContentsId: number) => unregisterGuest(tabId, webContentsId))
  ipcMain.handle('browser:syncWorktree', (_e, sync: BrowserWorktreeSync) => syncWorktree(sync))

  ipcMain.handle('browser:getSettings', () => getBrowserSettings())
  ipcMain.handle('browser:setSettings', (_e, patch: Partial<BrowserSettings>) => {
    const before = getBrowserSettings()
    const next = setBrowserSettings(patch)
    if (next.exposeToTerminalAgents !== before.exposeToTerminalAgents || next.registerAgentMcp !== before.registerAgentMcp) {
      syncAgentBrowserBridge(next)
    }
    return next
  })
  ipcMain.handle('browser:agentBridgeStatus', () => getAgentBridgeStatus())
  ipcMain.handle('browser:clearProfileData', async (_e, profileId: string) => {
    await profileSession(profileId).clearStorageData()
    await profileSession(profileId).clearCache()
  })
  ipcMain.handle('browser:deleteProfile', async (_e, profileId: string) => {
    if (profileId === DEFAULT_BROWSER_PROFILE_ID) throw new Error('The default profile cannot be deleted')
    // Wipe storage even if no tab ever used it this run.
    await electronSession.fromPartition(browserPartitionFor(profileId)).clearStorageData().catch(() => {})
    return setBrowserSettings({ profiles: getBrowserSettings().profiles.filter((p) => p.id !== profileId) })
  })

  ipcMain.handle('browser:setViewport', (_e, webContentsId: number, viewport: BrowserViewport | null, scale: number) =>
    setViewport(guestContents(webContentsId), viewport, scale))

  ipcMain.handle('browser:designPick', (_e, webContentsId: number) => pickElement(guestContents(webContentsId)))
  ipcMain.handle('browser:designSave', (_e, capture: DesignModeCapture) => saveCapture(capture))
  ipcMain.handle('browser:designCancel', (_e, webContentsId: number) => cancelPick(guestContents(webContentsId)))

  ipcMain.handle('browser:listChromiumProfiles', () => listChromiumProfiles())
  ipcMain.handle('browser:importCookiesFromBrowser', (_e, profileId: string, browser: ChromiumBrowser, profileDir: string) =>
    importChromiumCookies(profileSession(profileId), browser, profileDir))
  ipcMain.handle('browser:importCookiesFromFile', async (e, profileId: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Cookies', extensions: ['txt', 'json'] }, { name: 'All files', extensions: ['*'] }],
    }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || !picked.filePaths[0]) return null
    return importCookieFile(profileSession(profileId), picked.filePaths[0])
  })
}
