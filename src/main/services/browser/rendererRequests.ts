// Request/response channel main -> renderer for browser tab lifecycle
// (agents open, activate and close tabs; the renderer owns tab state).
import { BrowserWindow, ipcMain } from 'electron'
import type { BrowserRendererRequest, BrowserRendererRequestEnvelope } from '../../../shared/browser'

const REQUEST_TIMEOUT_MS = 10_000
let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let registered = false

function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.getURL().startsWith('devtools://')) ?? null
}

export function registerRendererRequestHandlers(): void {
  if (registered) return
  registered = true
  ipcMain.handle('browser:respond', (_e, id: number, ok: boolean, payload: unknown) => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (ok) entry.resolve(payload)
    else entry.reject(new Error(typeof payload === 'string' ? payload : 'Renderer request failed'))
  })
}

export function requestRenderer<T>(request: BrowserRendererRequest): Promise<T> {
  const win = mainWindow()
  if (!win) return Promise.reject(new Error('Braid window is not open'))
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Renderer did not answer ${request.type} in time`))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    const envelope: BrowserRendererRequestEnvelope = { id, request }
    win.webContents.send('browser:request', envelope)
  })
}
