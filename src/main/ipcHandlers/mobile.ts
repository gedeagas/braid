// Mobile companion server IPC handlers, split out of ipc.ts.

import { ipcMain } from 'electron'
import { mobileServer, deviceStore } from '../services/mobileServer'
import { mobileNgrokTunnel } from '../services/mobileServer/ngrokTunnel'
import type { MobilePairingTransport } from '../services/mobileServer/types'
import { mainSettings } from '../ipc'

export function registerMobileIpc(): void {
  // Mobile Companion Server
  ipcMain.handle('mobile:getStatus', () => mobileServer.getStatus())
  ipcMain.handle('mobile:start', async () => {
    const result = await mobileServer.start()
    mainSettings.mobileServerEnabled = true
    return result
  })
  ipcMain.handle('mobile:stop', () => {
    mobileNgrokTunnel.stop()
    mobileServer.stop()
    mainSettings.mobileServerEnabled = false
  })
  ipcMain.handle('mobile:generatePairingOffer', async (_e, options?: { transport?: MobilePairingTransport }) => {
    const transport = options?.transport ?? 'lan'
    if (transport === 'ngrok') {
      const status = mobileServer.getStatus()
      if (!status.port) return null
      const tunnel = await mobileNgrokTunnel.start(status.port, mainSettings.mobileNgrokRegion)
      if (!tunnel.endpoint) throw new Error('ngrok tunnel did not provide a public endpoint')
      return mobileServer.generatePairingOffer({ endpoint: tunnel.endpoint, transport })
    }
    return mobileServer.generatePairingOffer({ transport })
  })
  ipcMain.handle('mobile:getNgrokTunnelStatus', () => mobileNgrokTunnel.getStatus())
  ipcMain.handle('mobile:startNgrokTunnel', async () => {
    const status = mobileServer.getStatus()
    if (!status.port) throw new Error('Start the mobile companion server before starting ngrok.')
    return mobileNgrokTunnel.start(status.port, mainSettings.mobileNgrokRegion)
  })
  ipcMain.handle('mobile:stopNgrokTunnel', () => {
    mobileNgrokTunnel.stop()
    return mobileNgrokTunnel.getStatus()
  })
  ipcMain.handle('mobile:getDevices', () => deviceStore.load())
  ipcMain.handle('mobile:removeDevice', (_e, deviceId: string) => {
    // Drop the live socket first so its notification subscription stops firing,
    // then forget the device. Order matters: removing from the store alone leaves
    // an open connection that keeps pushing notifications to the phone.
    mobileServer.disconnectDevice(deviceId)
    deviceStore.removeDevice(deviceId)
  })
}
