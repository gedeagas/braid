// Download tracking for browser sessions: saves into the configured folder
// (no dialog) and streams progress to the renderer's downloads shelf.
import { app, BrowserWindow, ipcMain, shell, type DownloadItem, type Session } from 'electron'
import { existsSync } from 'fs'
import { extname, basename, join } from 'path'
import type { BrowserDownload } from '../../../shared/browser'
import { getBrowserSettings } from './settings'

const items = new Map<string, { item: DownloadItem; info: BrowserDownload }>()
const tracked = new WeakSet<Session>()
let nextId = 1
let registered = false

/** First free `name (n).ext` in `dir`. */
export function uniqueSavePath(dir: string, filename: string, exists: (p: string) => boolean = existsSync): string {
  const safe = basename(filename).replace(/[\u0000-\u001f/\\:]/g, '_') || 'download'
  const ext = extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  let candidate = join(dir, safe)
  for (let n = 1; exists(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

function broadcast(info: BrowserDownload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('browser:download', info)
  }
}

function stateOf(item: DownloadItem): BrowserDownload['state'] {
  const s = item.getState()
  return s === 'completed' || s === 'cancelled' || s === 'interrupted' ? s : 'progressing'
}

export function attachDownloadTracking(sess: Session): void {
  if (tracked.has(sess)) return
  tracked.add(sess)
  sess.on('will-download', (_event, item, wc) => {
    const dir = getBrowserSettings().downloadsDir || app.getPath('downloads')
    const savePath = uniqueSavePath(dir, item.getFilename())
    item.setSavePath(savePath)
    const id = `dl-${nextId++}`
    const info: BrowserDownload = {
      id,
      webContentsId: wc?.id ?? -1,
      filename: basename(savePath),
      savePath,
      url: item.getURL(),
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      state: 'progressing',
      startedAt: Date.now(),
    }
    items.set(id, { item, info })
    broadcast(info)
    let lastSent = 0
    item.on('updated', () => {
      info.receivedBytes = item.getReceivedBytes()
      info.totalBytes = item.getTotalBytes()
      info.state = stateOf(item)
      const now = Date.now()
      if (now - lastSent > 200) { lastSent = now; broadcast({ ...info }) }
    })
    item.once('done', (_e, state) => {
      info.receivedBytes = item.getReceivedBytes()
      info.state = state === 'completed' || state === 'cancelled' ? state : 'interrupted'
      broadcast({ ...info })
    })
  })
}

export function registerDownloadHandlers(): void {
  if (registered) return
  registered = true
  ipcMain.handle('browser:downloadCancel', (_e, id: string) => { items.get(id)?.item.cancel() })
  ipcMain.handle('browser:downloadOpen', async (_e, id: string) => {
    const entry = items.get(id)
    if (entry?.info.state === 'completed') await shell.openPath(entry.info.savePath)
  })
  ipcMain.handle('browser:downloadShow', (_e, id: string) => {
    const entry = items.get(id)
    if (entry) shell.showItemInFolder(entry.info.savePath)
  })
  ipcMain.handle('browser:downloadDismiss', (_e, id: string) => {
    const entry = items.get(id)
    if (entry && entry.info.state !== 'progressing') items.delete(id)
  })
}
