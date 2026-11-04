// browser bridge (window.api.browser). Split out of preload/index.ts.

import { ipcRenderer } from 'electron'
import type {
  BrowserAgentBridgeStatus, BrowserCookieImportResult, BrowserDownload, BrowserGuestInfo, BrowserOpenTabEvent, BrowserPermissionRequest,
  BrowserRendererRequestEnvelope, BrowserSettings, BrowserShortcutEvent, BrowserViewport, BrowserWorktreeSync, DesignModeCapture,
} from '../shared/browser'

export const browserBridge = {
  onShortcut: (callback: (event: BrowserShortcutEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: BrowserShortcutEvent) => callback(event)
    ipcRenderer.on('browser:shortcut', handler)
    return () => { ipcRenderer.removeListener('browser:shortcut', handler) }
  },
  onOpenTab: (callback: (event: BrowserOpenTabEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: BrowserOpenTabEvent) => callback(event)
    ipcRenderer.on('browser:openTab', handler)
    return () => { ipcRenderer.removeListener('browser:openTab', handler) }
  },
  onRequest: (callback: (event: BrowserRendererRequestEnvelope) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: BrowserRendererRequestEnvelope) => callback(event)
    ipcRenderer.on('browser:request', handler)
    return () => { ipcRenderer.removeListener('browser:request', handler) }
  },
  onDownload: (callback: (event: BrowserDownload) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: BrowserDownload) => callback(event)
    ipcRenderer.on('browser:download', handler)
    return () => { ipcRenderer.removeListener('browser:download', handler) }
  },
  onPermissionRequest: (callback: (event: BrowserPermissionRequest) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: BrowserPermissionRequest) => callback(event)
    ipcRenderer.on('browser:permissionRequest', handler)
    return () => { ipcRenderer.removeListener('browser:permissionRequest', handler) }
  },
  onPermissionCancel: (callback: (id: number) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: number) => callback(id)
    ipcRenderer.on('browser:permissionCancel', handler)
    return () => { ipcRenderer.removeListener('browser:permissionCancel', handler) }
  },
  onAutomationActivity: (callback: (event: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: string) => callback(event)
    ipcRenderer.on('browser:automationActivity', handler)
    return () => { ipcRenderer.removeListener('browser:automationActivity', handler) }
  },
  onRouteLink: (callback: (url: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('browser:routeLink', handler)
    return () => { ipcRenderer.removeListener('browser:routeLink', handler) }
  },
  respond: (id: number, ok: boolean, payload: unknown) => ipcRenderer.invoke('browser:respond', id, ok, payload) as Promise<void>,
  registerGuest: (info: BrowserGuestInfo) => ipcRenderer.invoke('browser:registerGuest', info) as Promise<void>,
  unregisterGuest: (tabId: string, webContentsId: number) => ipcRenderer.invoke('browser:unregisterGuest', tabId, webContentsId) as Promise<void>,
  syncWorktree: (sync: BrowserWorktreeSync) => ipcRenderer.invoke('browser:syncWorktree', sync) as Promise<void>,
  getSettings: () => ipcRenderer.invoke('browser:getSettings') as Promise<BrowserSettings>,
  agentBridgeStatus: () => ipcRenderer.invoke('browser:agentBridgeStatus') as Promise<BrowserAgentBridgeStatus>,
  setSettings: (patch: Partial<BrowserSettings>) => ipcRenderer.invoke('browser:setSettings', patch) as Promise<BrowserSettings>,
  clearProfileData: (profileId: string) => ipcRenderer.invoke('browser:clearProfileData', profileId) as Promise<void>,
  deleteProfile: (profileId: string) => ipcRenderer.invoke('browser:deleteProfile', profileId) as Promise<BrowserSettings>,
  setViewport: (webContentsId: number, viewport: BrowserViewport | null, scale: number) =>
    ipcRenderer.invoke('browser:setViewport', webContentsId, viewport, scale) as Promise<void>,
  designPick: (webContentsId: number) => ipcRenderer.invoke('browser:designPick', webContentsId) as Promise<DesignModeCapture | null>,
  designSave: (capture: DesignModeCapture) => ipcRenderer.invoke('browser:designSave', capture) as Promise<{ mdPath: string; pngPath: string | null }>,
  designCancel: (webContentsId: number) => ipcRenderer.invoke('browser:designCancel', webContentsId) as Promise<void>,
  respondPermission: (id: number, allow: boolean, remember: boolean) =>
    ipcRenderer.invoke('browser:permissionResponse', id, allow, remember) as Promise<void>,
  downloadCancel: (id: string) => ipcRenderer.invoke('browser:downloadCancel', id) as Promise<void>,
  downloadOpen: (id: string) => ipcRenderer.invoke('browser:downloadOpen', id) as Promise<void>,
  downloadShow: (id: string) => ipcRenderer.invoke('browser:downloadShow', id) as Promise<void>,
  downloadDismiss: (id: string) => ipcRenderer.invoke('browser:downloadDismiss', id) as Promise<void>,
  listChromiumProfiles: () => ipcRenderer.invoke('browser:listChromiumProfiles') as Promise<Array<{ browser: 'chrome' | 'edge'; profileDir: string; label: string }>>,
  importCookiesFromBrowser: (profileId: string, browser: 'chrome' | 'edge', profileDir: string) =>
    ipcRenderer.invoke('browser:importCookiesFromBrowser', profileId, browser, profileDir) as Promise<BrowserCookieImportResult>,
  importCookiesFromFile: (profileId: string) =>
    ipcRenderer.invoke('browser:importCookiesFromFile', profileId) as Promise<BrowserCookieImportResult | null>,
}
