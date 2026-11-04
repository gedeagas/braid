// Binds OutputDelivery to the app window: batches go out as `pty:data`.

import { BrowserWindow } from 'electron'
import { OutputDelivery, type DeliveryConfig, DEFAULT_DELIVERY_CONFIG } from './outputDelivery'

export function getAppWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows()[0] ?? null
  return win && !win.isDestroyed() ? win : null
}

export function sendToRenderer(channel: string, ...args: unknown[]): boolean {
  const win = getAppWindow()
  if (!win) return false
  win.webContents.send(channel, ...args)
  return true
}

export function createRendererDelivery(
  producer: { pause(id: string): void; resume(id: string): void },
  config: DeliveryConfig = DEFAULT_DELIVERY_CONFIG,
): OutputDelivery {
  return new OutputDelivery({
    send: (id, data) => sendToRenderer('pty:data', id, data),
    pause: (id) => producer.pause(id),
    resume: (id) => producer.resume(id),
  }, config)
}
