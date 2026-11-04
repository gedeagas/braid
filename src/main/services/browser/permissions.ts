// Permission prompts for browser tabs: benign permissions are granted, the
// rest are asked in the tab's permission bar and remembered per profile+origin.
import { BrowserWindow, ipcMain, type Session, type WebContents } from 'electron'
import type { BrowserPermissionRequest } from '../../../shared/browser'

const ALWAYS_ALLOWED = new Set<string>([
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
  'window-management',
])

/** Permissions a page may request through the prompt bar. Anything else is denied. */
const PROMPTABLE = new Set<string>([
  'media',
  'geolocation',
  'notifications',
  'clipboard-read',
  'midi',
  'midiSysex',
  'idle-detection',
  'storage-access',
  'top-level-storage-access',
  'speaker-selection',
])

const decisions = new WeakMap<Session, Map<string, boolean>>()
const pending = new Map<number, (allow: boolean, remember: boolean) => void>()
let nextId = 1
let registered = false

function originOf(url: string): string {
  try { return new URL(url).origin } catch { return url }
}

function decisionKey(origin: string, permission: string): string {
  return `${origin}\u0000${permission}`
}

function remembered(sess: Session): Map<string, boolean> {
  let map = decisions.get(sess)
  if (!map) { map = new Map(); decisions.set(sess, map) }
  return map
}

export function handlePermissionCheck(sess: Session, permission: string, requestingOrigin: string): boolean {
  if (ALWAYS_ALLOWED.has(permission)) return true
  return remembered(sess).get(decisionKey(originOf(requestingOrigin), permission)) === true
}

export function handlePermissionRequest(
  sess: Session,
  wc: WebContents,
  permission: string,
  requestingUrl: string,
  callback: (granted: boolean) => void,
): void {
  if (ALWAYS_ALLOWED.has(permission)) { callback(true); return }
  if (!PROMPTABLE.has(permission)) { callback(false); return }
  const origin = originOf(requestingUrl)
  const key = decisionKey(origin, permission)
  const known = remembered(sess).get(key)
  if (known !== undefined) { callback(known); return }

  const host = wc.hostWebContents ?? BrowserWindow.getAllWindows()[0]?.webContents
  if (!host || host.isDestroyed()) { callback(false); return }
  const id = nextId++
  pending.set(id, (allow, remember) => {
    if (remember) remembered(sess).set(key, allow)
    callback(allow)
  })
  // A navigation or a closed tab abandons the prompt.
  const abandon = () => { const fn = pending.get(id); if (fn) { pending.delete(id); fn(false, false) } }
  wc.once('did-start-navigation', abandon)
  wc.once('destroyed', abandon)
  const request: BrowserPermissionRequest = { id, webContentsId: wc.id, origin, permission }
  host.send('browser:permissionRequest', request)
}

export function registerPermissionHandlers(): void {
  if (registered) return
  registered = true
  ipcMain.handle('browser:permissionResponse', (_e, id: number, allow: boolean, remember: boolean) => {
    const fn = pending.get(id)
    if (!fn) return
    pending.delete(id)
    fn(Boolean(allow), Boolean(remember))
  })
}
