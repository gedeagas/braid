import { describe, it, expect, beforeEach, vi } from 'vitest'

// Controllable fake window list. The presence module reads
// BrowserWindow.getAllWindows() to broadcast and to detect closed windows.
type FakeWin = { isDestroyed: () => boolean; webContents: { id: number; send: ReturnType<typeof vi.fn> } }
let windows: FakeWin[] = []

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windows },
}))

function win(id: number): FakeWin {
  return { isDestroyed: () => false, webContents: { id, send: vi.fn() } }
}

// Each test gets a fresh module so the singleton Maps don't bleed across tests.
async function load() {
  vi.resetModules()
  return import('../mobileTerminalPresence')
}

beforeEach(() => {
  windows = []
})

describe('mobileTerminalPresence', () => {
  describe('mobile viewers', () => {
    it('marks active on the first device and broadcasts the 0->1 transition', async () => {
      windows = [win(1)]
      const p = await load()
      p.markMobileTerminalActive('bt-1', 'dev-a')
      expect(p.isMobileTerminalActive('bt-1')).toBe(true)
      expect(windows[0].webContents.send).toHaveBeenCalledWith('pty:mobileTerminalActive', {
        terminalId: 'bt-1',
        active: true,
      })
    })

    it('broadcasts only on 0->1 and 1->0 edges, not on every device', async () => {
      windows = [win(1)]
      const p = await load()
      p.markMobileTerminalActive('bt-1', 'dev-a')
      p.markMobileTerminalActive('bt-1', 'dev-b')
      // Second device joining must not re-broadcast.
      expect(windows[0].webContents.send).toHaveBeenCalledTimes(1)
      p.markMobileTerminalInactive('bt-1', 'dev-a')
      // One viewer remains - still active, no edge.
      expect(p.isMobileTerminalActive('bt-1')).toBe(true)
      expect(windows[0].webContents.send).toHaveBeenCalledTimes(1)
      p.markMobileTerminalInactive('bt-1', 'dev-b')
      expect(p.isMobileTerminalActive('bt-1')).toBe(false)
      expect(windows[0].webContents.send).toHaveBeenLastCalledWith('pty:mobileTerminalActive', {
        terminalId: 'bt-1',
        active: false,
      })
      expect(windows[0].webContents.send).toHaveBeenCalledTimes(2)
    })

    it('dedupes the same device subscribing twice', async () => {
      const p = await load()
      p.markMobileTerminalActive('bt-1', 'dev-a')
      p.markMobileTerminalActive('bt-1', 'dev-a')
      p.markMobileTerminalInactive('bt-1', 'dev-a')
      expect(p.isMobileTerminalActive('bt-1')).toBe(false)
    })
  })

  describe('getTerminalPresence', () => {
    it('excludes the asking device from the other-device count', async () => {
      const p = await load()
      p.markMobileTerminalActive('bt-1', 'dev-a')
      p.markMobileTerminalActive('bt-1', 'dev-b')
      expect(p.getTerminalPresence('bt-1', { excludeDeviceId: 'dev-a' }).otherMobileDeviceCount).toBe(1)
      expect(p.getTerminalPresence('bt-1').otherMobileDeviceCount).toBe(2)
    })

    it('reports openOnDesktop when a live window is viewing the terminal', async () => {
      windows = [win(7)]
      const p = await load()
      p.setDesktopActiveTerminal(7, 'bt-1')
      expect(p.getTerminalPresence('bt-1').openOnDesktop).toBe(true)
      expect(p.getTerminalPresence('bt-2').openOnDesktop).toBe(false)
    })
  })

  describe('isTerminalOpenOnDesktop', () => {
    it('is true only while the viewing window is alive', async () => {
      windows = [win(7)]
      const p = await load()
      p.setDesktopActiveTerminal(7, 'bt-1')
      expect(p.isTerminalOpenOnDesktop('bt-1')).toBe(true)
      // Window closes - the stale entry must be ignored (and self-cleaned).
      windows = []
      expect(p.isTerminalOpenOnDesktop('bt-1')).toBe(false)
    })

    it('treats a null active terminal as not open', async () => {
      windows = [win(7)]
      const p = await load()
      p.setDesktopActiveTerminal(7, 'bt-1')
      p.setDesktopActiveTerminal(7, null)
      expect(p.isTerminalOpenOnDesktop('bt-1')).toBe(false)
    })
  })
})
