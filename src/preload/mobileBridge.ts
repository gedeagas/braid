// mobile bridge (window.api.mobile). Split out of preload/index.ts.

import { ipcRenderer } from 'electron'

export const mobileBridge = {
  getStatus: () => ipcRenderer.invoke('mobile:getStatus') as Promise<{
    running: boolean; port: number | null;
    connectedDevices: Array<{ id: string; name: string; connectedAt: number }>
  }>,
  start: () => ipcRenderer.invoke('mobile:start') as Promise<{ port: number }>,
  stop: () => ipcRenderer.invoke('mobile:stop') as Promise<void>,
  generatePairingOffer: (options?: { transport?: 'lan' | 'ngrok' }) =>
    ipcRenderer.invoke('mobile:generatePairingOffer', options) as Promise<{
      endpoint: string; token: string; serverPublicKey: string; transport?: 'lan' | 'ngrok'
    } | null>,
  getNgrokTunnelStatus: () => ipcRenderer.invoke('mobile:getNgrokTunnelStatus') as Promise<{
    running: boolean; port: number | null; url: string | null; endpoint: string | null; startedAt: number | null; error: string | null
  }>,
  startNgrokTunnel: () => ipcRenderer.invoke('mobile:startNgrokTunnel') as Promise<{
    running: boolean; port: number | null; url: string | null; endpoint: string | null; startedAt: number | null; error: string | null
  }>,
  stopNgrokTunnel: () => ipcRenderer.invoke('mobile:stopNgrokTunnel') as Promise<{
    running: boolean; port: number | null; url: string | null; endpoint: string | null; startedAt: number | null; error: string | null
  } | null>,
  getDevices: () => ipcRenderer.invoke('mobile:getDevices') as Promise<Array<{
    id: string; name: string; publicKey: string; pairedAt: number; lastSeenAt: number
  }>>,
  removeDevice: (deviceId: string) => ipcRenderer.invoke('mobile:removeDevice', deviceId) as Promise<void>,
  // A device authenticated (isNewPairing=true when it just consumed the
  // one-time pairing QR). Lets the pairing UI update live.
  onDeviceConnected: (
    callback: (info: { deviceId: string; name: string; isNewPairing: boolean }) => void
  ) => {
    const handler = (_e: Electron.IpcRendererEvent, info: { deviceId: string; name: string; isNewPairing: boolean }) => callback(info)
    ipcRenderer.on('mobile:deviceConnected', handler)
    return () => ipcRenderer.removeListener('mobile:deviceConnected', handler)
  },
  onDeviceDisconnected: (callback: (info: { deviceId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: { deviceId: string }) => callback(info)
    ipcRenderer.on('mobile:deviceDisconnected', handler)
    return () => ipcRenderer.removeListener('mobile:deviceDisconnected', handler)
  },
  // A paired device asked to remove a worktree. The main process forwards it
  // here so the renderer runs its full teardown flow; reply via
  // sendRemoveWorktreeResult so main knows it succeeded (or must fall back).
  onRemoveWorktreeRequest: (
    callback: (req: { requestId: string; repoPath: string; worktreePath: string }) => void
  ) => {
    const handler = (_e: Electron.IpcRendererEvent, req: { requestId: string; repoPath: string; worktreePath: string }) => callback(req)
    ipcRenderer.on('mobile:removeWorktreeRequest', handler)
    return () => ipcRenderer.removeListener('mobile:removeWorktreeRequest', handler)
  },
  sendRemoveWorktreeResult: (result: { requestId: string; ok: boolean; reason?: string }) =>
    ipcRenderer.send('mobile:removeWorktreeResult', result),
  // A paired device asked to create a worktree. The main process forwards it
  // here so the renderer runs its full add flow (stable id, storage path,
  // sidebar refresh); reply via sendCreateWorktreeResult so main knows it
  // succeeded (or must fall back).
  onCreateWorktreeRequest: (
    callback: (req: { requestId: string; repoPath: string; branch: string; baseBranch?: string; filesToCopy?: string[] }) => void
  ) => {
    const handler = (_e: Electron.IpcRendererEvent, req: { requestId: string; repoPath: string; branch: string; baseBranch?: string; filesToCopy?: string[] }) => callback(req)
    ipcRenderer.on('mobile:createWorktreeRequest', handler)
    return () => ipcRenderer.removeListener('mobile:createWorktreeRequest', handler)
  },
  sendCreateWorktreeResult: (result: { requestId: string; ok: boolean; reason?: string; worktreePath?: string; worktreeId?: string }) =>
    ipcRenderer.send('mobile:createWorktreeResult', result),
}
