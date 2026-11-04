import { describe, it, expect, vi } from 'vitest'

// Warm terminals (attached in main only, no xterm) must stay visible to agent
// hibernation, and hibernating one must kill its PTY.
const pty = vi.hoisted(() => ({ kill: vi.fn(), setVisible: vi.fn(), deleteScrollback: vi.fn() }))
vi.mock('@/lib/ipc', () => ({ pty }))
const ui = vi.hoisted(() => ({ clearBigTerminalStatus: vi.fn(), seedRestoredBigTerminalStatus: vi.fn() }))
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ui } }))
vi.mock('@/store/toasts', () => ({ useToastsStore: { getState: () => ({ dismissByTerminal: vi.fn() }) } }))
vi.mock('@/components/Right/terminalCache', () => ({ createTerminal: vi.fn(), registerPtyFinder: vi.fn() }))
vi.mock('../bigTerminalConnect', () => ({ connectBigTerminal: vi.fn() }))

import { registerWarmBigTerminal, listBigTerminalActivity, hibernateBigTerminal, isWarmBigTerminal, getBigTerminalPtyId } from '../bigTerminalCache'

describe('warm big terminals', () => {
  it('report their PTY id, so a Design Mode pick can be typed into one not opened yet', () => {
    registerWarmBigTerminal('bt-7-7', 'pty-7')
    expect(getBigTerminalPtyId('bt-7-7')).toBe('pty-7')
    expect(getBigTerminalPtyId('bt-unknown')).toBeNull()
  })

  it('are listed for hibernation with the daemon\'s last output time', () => {
    registerWarmBigTerminal('bt-9-9', 'bt-9-9')
    const activity = listBigTerminalActivity(new Map([['bt-9-9', Date.now() + 5_000]]))
    const warm = activity.find((a) => a.terminalId === 'bt-9-9')
    expect(warm).toMatchObject({ mobileInputLocked: false })
    expect(warm!.lastOutputAt).toBeGreaterThan(Date.now())
  })

  it('hibernate by killing the PTY (main writes the scrollback) and keep the tab resumable', () => {
    registerWarmBigTerminal('bt-8-8', 'bt-8-8')
    expect(hibernateBigTerminal('bt-8-8', 'claude')).toBe(true)
    expect(pty.kill).toHaveBeenCalledWith('bt-8-8')
    expect(isWarmBigTerminal('bt-8-8')).toBe(false)
    expect(ui.seedRestoredBigTerminalStatus).toHaveBeenCalledWith([{ terminalId: 'bt-8-8', agentType: 'claude' }])
  })
})
