import { BrowserWindow } from 'electron'

/**
 * Per-terminal display mode requested by a paired mobile device.
 *
 * - `phone`   (default): the desktop yields and the phone drives the PTY at its
 *   own (small) viewport dimensions. The desktop terminal is held (see
 *   `BigTerminalView`'s `heldForMobile`).
 * - `desktop`: the phone wants to view the terminal at the desktop's native
 *   dimensions. The desktop un-holds and fits to its own pane; the phone scales
 *   that wider canvas down to fit (xterm CSS transform in `TerminalWebView`).
 */
export type MobileDisplayMode = 'phone' | 'desktop'

const modes = new Map<string, MobileDisplayMode>()

function emit(terminalId: string, mode: MobileDisplayMode): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('pty:mobileDisplayMode', { terminalId, mode })
    }
  }
}

export function getMobileDisplayMode(terminalId: string): MobileDisplayMode {
  return modes.get(terminalId) ?? 'phone'
}

export function setMobileDisplayMode(terminalId: string, mode: MobileDisplayMode): void {
  const current = getMobileDisplayMode(terminalId)
  if (current === mode) return
  if (mode === 'phone') modes.delete(terminalId)
  else modes.set(terminalId, mode)
  emit(terminalId, mode)
}

/** Reset a terminal to the default phone mode (e.g. when the device disconnects). */
export function resetMobileDisplayMode(terminalId: string): void {
  setMobileDisplayMode(terminalId, 'phone')
}
