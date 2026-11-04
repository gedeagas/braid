// PTY bridge (window.api.pty). Split out of preload/index.ts.

import { ipcRenderer } from 'electron'
import type { AgentResumeClaim } from '../shared/agent-resume'
import type { DaemonAgentStatusEvent, HeadlessSnapshotResult } from '../shared/terminal-offload'

export const ptyBridge = {
  spawn: (cwd: string, envOverrides?: Record<string, string>) => ipcRenderer.invoke('pty:spawn', cwd, envOverrides),
  write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
  /** The pty:data listener is up; main holds output until then after a reload. */
  rendererReady: () => ipcRenderer.send('pty:rendererReady'),
  /** Flow control: running total of output characters processed for `id`. */
  ackData: (id: string, processedTotal: number) => ipcRenderer.send('pty:ackData', id, processedTotal),
  /** The terminal is shown (true) or hidden (false) in the UI. */
  setVisible: (id: string, visible: boolean) => ipcRenderer.send('pty:setVisible', id, visible),
  headlessSnapshot: (sessionId: string) =>
    ipcRenderer.invoke('pty:headlessSnapshot', sessionId) as Promise<HeadlessSnapshotResult | null>,
  snapshotApplied: (sessionId: string, seq: number) => ipcRenderer.send('pty:snapshotApplied', sessionId, seq),
  setDeliveryInterest: (sessionId: string, interested: boolean) => ipcRenderer.send('pty:setDeliveryInterest', sessionId, interested),
  setTerminalColors: (colors: { foreground?: string; background?: string; cursor?: string }) => ipcRenderer.send('pty:setTerminalColors', colors),
  onAgentStatus: (callback: (event: DaemonAgentStatusEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: DaemonAgentStatusEvent) => callback(event)
    ipcRenderer.on('pty:agentStatus', handler)
    return () => ipcRenderer.removeListener('pty:agentStatus', handler)
  },
  /** Terminal backend capabilities (daemon hello features). */
  getFeatures: () => ipcRenderer.invoke('pty:getFeatures') as Promise<string[]>,
  onFeaturesChanged: (callback: (features: string[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, features: string[]) => callback(features)
    ipcRenderer.on('pty:featuresChanged', handler)
    return () => ipcRenderer.removeListener('pty:featuresChanged', handler)
  },
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id: string) => ipcRenderer.invoke('pty:kill', id),
  runScript: (cwd: string, command: string) => ipcRenderer.invoke('pty:runScript', cwd, command) as Promise<{ exitCode: number }>,
  readTerminalOutput: (worktreePath: string) => ipcRenderer.invoke('pty:readTerminalOutput', worktreePath) as Promise<Array<{ ptyId: string; output: string }>>,
  onData: (callback: (id: string, data: string, noReply?: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, data: string, noReply?: boolean) => callback(id, data, noReply === true)
    ipcRenderer.on('pty:data', handler)
    return () => ipcRenderer.removeListener('pty:data', handler)
  },
  onExit: (callback: (id: string, exitCode: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, exitCode: number) => callback(id, exitCode)
    ipcRenderer.on('pty:exit', handler)
    return () => ipcRenderer.removeListener('pty:exit', handler)
  },
  registerBigTerminal: (ptyId: string, terminalId: string) =>
    ipcRenderer.send('pty:registerBigTerminal', ptyId, terminalId),
  setBigTerminalMetadata: (metadata: { terminalId: string; worktreeId?: string; label?: string; agentId?: string }) =>
    ipcRenderer.send('pty:setBigTerminalMetadata', metadata),
  removeBigTerminalMetadata: (terminalId: string) =>
    ipcRenderer.send('pty:removeBigTerminalMetadata', terminalId),
  killBigTerminal: (terminalId: string) =>
    ipcRenderer.send('pty:killBigTerminal', terminalId),
  renameBigTerminal: (payload: { terminalId: string; worktreeId?: string; label: string; agentId?: string }) =>
    ipcRenderer.send('pty:renameBigTerminal', payload),
  readScrollback: (terminalId: string) =>
    ipcRenderer.invoke('pty:readScrollback', terminalId) as Promise<string>,
  isMobileTerminalActive: (terminalId: string) =>
    ipcRenderer.invoke('pty:isMobileTerminalActive', terminalId) as Promise<boolean>,
  setDesktopActiveTerminal: (terminalId: string | null) =>
    ipcRenderer.send('pty:setDesktopActiveTerminal', terminalId),
  setMobileDisplayMode: (terminalId: string, mode: 'phone' | 'desktop') =>
    ipcRenderer.send('pty:setMobileDisplayMode', terminalId, mode),
  deleteScrollback: (terminalId: string) =>
    ipcRenderer.send('pty:deleteScrollback', terminalId),
  reattach: (sessionId: string, opts?: { snapshot?: boolean }) =>
    ipcRenderer.invoke('pty:reattach', sessionId, opts) as Promise<{ sessionId: string; snapshot: string; coldRestored?: boolean; foregroundAtLoss?: 'shell' | 'command' } | null>,
  consumeColdRestore: (sessionId: string) =>
    ipcRenderer.invoke('pty:consumeColdRestore', sessionId) as Promise<boolean>,
  listSessions: () =>
    ipcRenderer.invoke('pty:listSessions') as Promise<Array<{ sessionId: string; cwd: string; cols: number; rows: number; createdAt: number; coldRestored?: boolean; foreground?: 'shell' | 'command' }>>,
  listOrphanedBigTerminals: (knownTerminalIds: string[]) =>
    ipcRenderer.invoke('pty:listOrphanedBigTerminals', knownTerminalIds) as Promise<Array<{ terminalId: string; cwd: string; label?: string; agentId?: string }>>,
  killOrphanedBigTerminals: (terminalIds: string[]) =>
    ipcRenderer.invoke('pty:killOrphanedBigTerminals', terminalIds) as Promise<number>,
  setKnownBigTerminals: (items: Array<{ terminalId: string; label?: string; agentId?: string; worktreeId?: string }>) =>
    ipcRenderer.send('pty:setKnownBigTerminals', items),
  onAgentHookStatus: (callback: (status: { terminalId: string; state: string; agentType: string; toolName?: string; interrupted?: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { terminalId: string; state: string; agentType: string; toolName?: string; interrupted?: boolean }) => callback(status)
    ipcRenderer.on('agent-hook:status', handler)
    return () => ipcRenderer.removeListener('agent-hook:status', handler)
  },
  claimAgentResume: (terminalId: string) =>
    ipcRenderer.invoke('agentSessions:claimResume', terminalId) as Promise<AgentResumeClaim | null>,
  listAgentSessions: () =>
    ipcRenderer.invoke('agentSessions:list') as Promise<Array<{ terminalId: string; session: { agent: string; id: string }; state?: string }>>,
  forgetAgentResume: (terminalId: string) =>
    ipcRenderer.send('agentSessions:forget', terminalId),
  onMobileTerminalActive: (callback: (status: { terminalId: string; active: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { terminalId: string; active: boolean }) => callback(status)
    ipcRenderer.on('pty:mobileTerminalActive', handler)
    return () => ipcRenderer.removeListener('pty:mobileTerminalActive', handler)
  },
  onMobileDisplayMode: (callback: (status: { terminalId: string; mode: 'phone' | 'desktop' }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { terminalId: string; mode: 'phone' | 'desktop' }) => callback(status)
    ipcRenderer.on('pty:mobileDisplayMode', handler)
    return () => ipcRenderer.removeListener('pty:mobileDisplayMode', handler)
  },
  onMobileFit: (callback: (status: { terminalId: string; cols: number; rows: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { terminalId: string; cols: number; rows: number }) => callback(status)
    ipcRenderer.on('pty:mobileFit', handler)
    return () => ipcRenderer.removeListener('pty:mobileFit', handler)
  },
  onBigTerminalRegistered: (callback: (tab: { terminalId: string; worktreeId?: string; worktreePath?: string; label?: string; agentId?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tab: { terminalId: string; worktreeId?: string; worktreePath?: string; label?: string; agentId?: string }) => callback(tab)
    ipcRenderer.on('pty:bigTerminalRegistered', handler)
    return () => ipcRenderer.removeListener('pty:bigTerminalRegistered', handler)
  },
  onBigTerminalRenamed: (callback: (tab: { terminalId: string; worktreeId?: string; worktreePath?: string; label: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tab: { terminalId: string; worktreeId?: string; worktreePath?: string; label: string }) => callback(tab)
    ipcRenderer.on('pty:bigTerminalRenamed', handler)
    return () => ipcRenderer.removeListener('pty:bigTerminalRenamed', handler)
  },
  onBigTerminalClosed: (callback: (tab: { terminalId: string; worktreeId?: string; worktreePath?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tab: { terminalId: string; worktreeId?: string; worktreePath?: string }) => callback(tab)
    ipcRenderer.on('pty:bigTerminalClosed', handler)
    return () => ipcRenderer.removeListener('pty:bigTerminalClosed', handler)
  },
}
