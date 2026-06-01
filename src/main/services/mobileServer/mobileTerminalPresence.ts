import { BrowserWindow } from 'electron'

const counts = new Map<string, number>()

function emit(terminalId: string, active: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('pty:mobileTerminalActive', { terminalId, active })
    }
  }
}

export function markMobileTerminalActive(terminalId: string): void {
  const next = (counts.get(terminalId) ?? 0) + 1
  counts.set(terminalId, next)
  if (next === 1) emit(terminalId, true)
}

export function markMobileTerminalInactive(terminalId: string): void {
  const current = counts.get(terminalId) ?? 0
  if (current <= 1) {
    counts.delete(terminalId)
    emit(terminalId, false)
    return
  }
  counts.set(terminalId, current - 1)
}

export function isMobileTerminalActive(terminalId: string): boolean {
  return (counts.get(terminalId) ?? 0) > 0
}
