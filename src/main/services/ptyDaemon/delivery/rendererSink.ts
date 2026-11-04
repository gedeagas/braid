// Binds OutputDelivery to the app window: batches go out as `pty:data`.

import { BrowserWindow } from 'electron'
import { type DeliveryConfig, DEFAULT_DELIVERY_CONFIG } from './outputDelivery'
import { OffloadingDelivery, type DeliveringInfo } from './offloadDelivery'

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
  onDeliveringChange?: (id: string, delivering: boolean, info: DeliveringInfo) => void,
  config: DeliveryConfig = DEFAULT_DELIVERY_CONFIG,
): OffloadingDelivery {
  return new OffloadingDelivery({
    send: (id, data, noReply) => (noReply ? sendToRenderer('pty:data', id, data, true) : sendToRenderer('pty:data', id, data)),
    pause: (id) => producer.pause(id),
    resume: (id) => producer.resume(id),
  }, config, onDeliveringChange)
}
