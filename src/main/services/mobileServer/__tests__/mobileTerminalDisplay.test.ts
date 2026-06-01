import { describe, it, expect, vi, beforeEach } from 'vitest'

// emit() iterates BrowserWindow.getAllWindows(); we capture the IPC sends.
const sent: Array<{ channel: string; payload: unknown }> = []
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } },
    ],
  },
}))

const { getMobileDisplayMode, setMobileDisplayMode, resetMobileDisplayMode } = await import('../mobileTerminalDisplay')

describe('mobileTerminalDisplay', () => {
  beforeEach(() => {
    sent.length = 0
    resetMobileDisplayMode('bt-1')
    sent.length = 0
  })

  it('defaults to phone mode', () => {
    expect(getMobileDisplayMode('bt-unknown')).toBe('phone')
  })

  it('sets desktop mode and notifies the renderer', () => {
    setMobileDisplayMode('bt-1', 'desktop')
    expect(getMobileDisplayMode('bt-1')).toBe('desktop')
    expect(sent).toEqual([
      { channel: 'pty:mobileDisplayMode', payload: { terminalId: 'bt-1', mode: 'desktop' } },
    ])
  })

  it('does not re-emit when the mode is unchanged', () => {
    setMobileDisplayMode('bt-1', 'desktop')
    sent.length = 0
    setMobileDisplayMode('bt-1', 'desktop')
    expect(sent).toHaveLength(0)
  })

  it('reset returns the terminal to phone mode', () => {
    setMobileDisplayMode('bt-1', 'desktop')
    sent.length = 0
    resetMobileDisplayMode('bt-1')
    expect(getMobileDisplayMode('bt-1')).toBe('phone')
    expect(sent).toEqual([
      { channel: 'pty:mobileDisplayMode', payload: { terminalId: 'bt-1', mode: 'phone' } },
    ])
  })
})
