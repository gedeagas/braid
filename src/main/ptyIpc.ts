// PTY IPC handlers (pty:*). Split out of ipc.ts; registered from registerIpcHandlers().

import { ipcMain, BrowserWindow } from 'electron'
import { ptyService } from './services/pty'
import { broadcastMobileNotification } from './services/mobileServer/broadcast'
import { agentSessionStore } from './services/agentSessions'
import { hasKnownBigTerminals, setKnownBigTerminals, type KnownBigTerminal } from './services/mobileServer/knownBigTerminals'
import { isMobileTerminalActive, setDesktopActiveTerminal } from './services/mobileServer/mobileTerminalPresence'
import { setMobileDisplayMode, getMobileDisplayMode, type MobileDisplayMode } from './services/mobileServer/mobileTerminalDisplay'
import { getMobileTerminalActor } from './services/mobileServer/mobileTerminalActor'

export function registerPtyIpcHandlers(): void {
  ipcMain.handle('pty:spawn', (_e, cwd: string, envOverrides?: Record<string, string>) => ptyService.spawn(cwd, envOverrides))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptyService.write(id, data))
  // Flow control: the renderer's running total of output it has processed.
  // The renderer's pty:data listener is up (after each page load).
  ipcMain.on('pty:rendererReady', () => ptyService.setRendererReady?.())
  ipcMain.on('pty:ackData', (_e, id: string, processedTotal: number) => ptyService.ackData?.(id, processedTotal))
  // Capabilities of the terminal backend (daemon hello features). The renderer
  // branches on these, never on app version: a daemon from an older build can
  // outlive an app update and keep serving its sessions.
  // Which terminals the user can see: their output is delivered first.
  ipcMain.on('pty:setVisible', (_e, id: string, visible: boolean) => ptyService.setVisible?.(id, visible === true))
  ipcMain.handle('pty:getFeatures', () => ptyService.getFeatures?.() ?? [])
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    // Suppress desktop-driven resizes while a mobile device owns this terminal's
    // viewport (phone-fit). A shared PTY can't satisfy both sizes; the phone is
    // the active driver, so the desktop must not fit the PTY to its own pane and
    // clobber the phone-fit dims (which would wrap the phone's output wrong). The
    // desktop reclaims by hitting "Restore desktop size" (-> display mode
    // 'desktop'), which lifts this guard. Defense-in-depth behind
    // BigTerminalView's own held check, covering the mount/connect race before
    // the renderer learns it's held.
    const terminalId = ptyService.listInstances().find((item) => item.ptyId === id)?.terminalId
    if (terminalId && getMobileTerminalActor(terminalId) && getMobileDisplayMode(terminalId) !== 'desktop') {
      return
    }
    ptyService.resize(id, cols, rows)
  })

  ipcMain.handle('pty:kill', (_e, id: string) => ptyService.kill(id))
  ipcMain.handle('pty:runScript', (_e, cwd: string, command: string) => ptyService.runScript(cwd, command))
  ipcMain.handle('pty:readTerminalOutput', (_e, worktreePath: string) => ptyService.readTerminalOutput(worktreePath))
  ipcMain.on('pty:registerBigTerminal', (_e, ptyId: string, terminalId: string) => {
    ptyService.registerBigTerminal(ptyId, terminalId)
    // A big terminal just went live - either freshly created on the desktop, or
    // restored/reattached after a cold start when its worktree was opened. Tell
    // connected devices so their tab strip refreshes; the mobile terminal screen
    // doesn't poll terminal.list on its own, so without this a restored terminal
    // stays invisible until the user manually pulls to refresh.
    const worktreePath = ptyService.listInstances().find((t) => t.terminalId === terminalId)?.cwd
    broadcastMobileNotification({ jsonrpc: '2.0', method: 'terminal.listChanged', params: { worktreePath } })
  })
  ipcMain.on('pty:setBigTerminalMetadata', (_e, metadata: { terminalId: string; worktreeId?: string; label?: string; agentId?: string }) =>
    ptyService.setBigTerminalMetadata?.(metadata))
  ipcMain.on('pty:removeBigTerminalMetadata', (_e, terminalId: string) =>
    ptyService.removeBigTerminalMetadata?.(terminalId))
  // Rename: persist the new label, then mirror it to other desktop windows and
  // every connected mobile device so the tab strip updates live everywhere.
  ipcMain.on('pty:renameBigTerminal', (e, payload: { terminalId: string; worktreeId?: string; label: string; agentId?: string }) => {
    ptyService.setBigTerminalMetadata?.({
      terminalId: payload.terminalId,
      worktreeId: payload.worktreeId,
      label: payload.label,
      agentId: payload.agentId,
    })
    const worktreePath = ptyService.listInstances().find((t) => t.terminalId === payload.terminalId)?.cwd
    const notice = { terminalId: payload.terminalId, worktreeId: payload.worktreeId, worktreePath, label: payload.label }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents !== e.sender) win.webContents.send('pty:bigTerminalRenamed', notice)
    }
    broadcastMobileNotification({ jsonrpc: '2.0', method: 'terminal.tabRenamed', params: notice })
  })
  ipcMain.on('pty:killBigTerminal', (e, terminalId: string) => {
    // Capture worktree context before the kill clears the metadata.
    const instance = ptyService.listInstances().find((t) => t.terminalId === terminalId)
    const notice = { terminalId, worktreeId: instance?.worktreeId, worktreePath: instance?.cwd }
    ptyService.killBigTerminal?.(terminalId)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents !== e.sender) win.webContents.send('pty:bigTerminalClosed', notice)
    }
    broadcastMobileNotification({ jsonrpc: '2.0', method: 'terminal.tabClosed', params: notice })
  })
  ipcMain.handle('pty:readScrollback', (_e, terminalId: string) => ptyService.readScrollback(terminalId))
  ipcMain.handle('pty:isMobileTerminalActive', (_e, terminalId: string) => isMobileTerminalActive(terminalId))
  ipcMain.on('pty:setDesktopActiveTerminal', (e, terminalId: string | null) =>
    setDesktopActiveTerminal(e.sender.id, terminalId))
  ipcMain.on('pty:setMobileDisplayMode', (_e, terminalId: string, mode: MobileDisplayMode) =>
    setMobileDisplayMode(terminalId, mode))
  ipcMain.on('pty:deleteScrollback', (_e, terminalId: string) => ptyService.deleteScrollback(terminalId))
  ipcMain.handle('pty:reattach', (_e, sessionId: string) => {
    if ('reattach' in ptyService && typeof ptyService.reattach === 'function') {
      return ptyService.reattach(sessionId)
    }
    return null
  })
  ipcMain.handle('pty:consumeColdRestore', (_e, sessionId: string) =>
    ptyService.consumeColdRestore?.(sessionId) ?? false)
  ipcMain.handle('pty:listSessions', () => {
    if ('listSessions' in ptyService && typeof ptyService.listSessions === 'function') {
      return ptyService.listSessions()
    }
    return []
  })
  ipcMain.handle('pty:listOrphanedBigTerminals', (_e, knownTerminalIds: string[]) => {
    if ('listOrphanedBigTerminals' in ptyService && typeof ptyService.listOrphanedBigTerminals === 'function') {
      return ptyService.listOrphanedBigTerminals(knownTerminalIds)
    }
    return []
  })
  ipcMain.handle('pty:killOrphanedBigTerminals', (_e, terminalIds: string[]) => {
    if ('killOrphanedBigTerminals' in ptyService && typeof ptyService.killOrphanedBigTerminals === 'function') {
      return ptyService.killOrphanedBigTerminals(terminalIds)
    }
    return 0
  })
  // The renderer reports the full set of big-terminal ids it tracks (across all
  // worktrees) so the mobile terminal.list can surface terminals in worktrees the
  // desktop hasn't reopened while still excluding orphaned daemon sessions.
  ipcMain.on('pty:setKnownBigTerminals', (_e, items: KnownBigTerminal[]) => {
    // The first set unlocks daemon-sourced listing (before it, mobile falls back
    // to clicked-only). Nudge connected devices to re-query so a device that
    // loaded during the startup window picks up the full list. Later updates are
    // already covered by the create/close listChanged broadcasts.
    const first = !hasKnownBigTerminals()
    setKnownBigTerminals(Array.isArray(items) ? items : [])
    // The same set is authoritative for which saved agent sessions still matter.
    if (Array.isArray(items)) {
      agentSessionStore.retainOnly(new Set(items.map((i) => i?.terminalId).filter((id): id is string => typeof id === 'string')))
    }
    if (first) broadcastMobileNotification({ jsonrpc: '2.0', method: 'terminal.listChanged', params: {} })
  })
}
