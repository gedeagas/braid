import { BrowserWindow } from 'electron'

// ─── Mobile viewers ──────────────────────────────────────────────────────────
// Which paired devices currently have each terminal subscribed (open). Tracked as
// a set of device ids (not just a count) so terminal.presence can exclude the
// device that is asking - it already knows it has the terminal open.
const mobileViewers = new Map<string, Set<string>>()

function emit(terminalId: string, active: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('pty:mobileTerminalActive', { terminalId, active })
    }
  }
}

export function markMobileTerminalActive(terminalId: string, deviceId: string): void {
  let viewers = mobileViewers.get(terminalId)
  if (!viewers) {
    viewers = new Set()
    mobileViewers.set(terminalId, viewers)
  }
  const wasEmpty = viewers.size === 0
  viewers.add(deviceId)
  if (wasEmpty) emit(terminalId, true)
}

export function markMobileTerminalInactive(terminalId: string, deviceId: string): void {
  const viewers = mobileViewers.get(terminalId)
  if (!viewers) return
  viewers.delete(deviceId)
  if (viewers.size === 0) {
    mobileViewers.delete(terminalId)
    emit(terminalId, false)
  }
}

export function isMobileTerminalActive(terminalId: string): boolean {
  return (mobileViewers.get(terminalId)?.size ?? 0) > 0
}

// ─── Desktop viewers ─────────────────────────────────────────────────────────
// Which big terminal each renderer window is currently viewing (its active center
// view). Keyed by webContents id so a multi-window desktop is handled and a closed
// window is self-cleaned lazily (no lifecycle hook needed). null = not viewing a
// terminal. This is the reverse of the mobile signal: it lets a phone learn that a
// terminal it is about to close is also open on the desktop.
const desktopActive = new Map<number, string | null>()

export function setDesktopActiveTerminal(windowId: number, terminalId: string | null): void {
  desktopActive.set(windowId, terminalId)
}

export function isTerminalOpenOnDesktop(terminalId: string): boolean {
  const liveIds = new Set(
    BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).map((win) => win.webContents.id),
  )
  let open = false
  for (const [windowId, tid] of desktopActive) {
    if (!liveIds.has(windowId)) {
      desktopActive.delete(windowId)
      continue
    }
    if (tid === terminalId) open = true
  }
  return open
}

// ─── Combined presence ───────────────────────────────────────────────────────
// Answers "is this terminal open anywhere other than the asking device?". Used by
// the terminal.presence RPC to drive the mobile "open elsewhere" close warning.
export function getTerminalPresence(
  terminalId: string,
  opts?: { excludeDeviceId?: string },
): { openOnDesktop: boolean; otherMobileDeviceCount: number } {
  const viewers = mobileViewers.get(terminalId)
  let otherMobileDeviceCount = 0
  if (viewers) {
    for (const deviceId of viewers) {
      if (deviceId === opts?.excludeDeviceId) continue
      otherMobileDeviceCount++
    }
  }
  return { openOnDesktop: isTerminalOpenOnDesktop(terminalId), otherMobileDeviceCount }
}
