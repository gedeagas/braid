import { describe, it, expect, vi, beforeEach } from 'vitest'

const pty = vi.hoisted(() => ({
  reattach: vi.fn(),
  readScrollback: vi.fn(async () => ''),
  spawn: vi.fn(async () => 'pty-1'),
  registerBigTerminal: vi.fn(),
  write: vi.fn(),
  consumeColdRestore: vi.fn(async () => false),
}))
vi.mock('@/lib/ipc', () => ({ pty }))
vi.mock('@/lib/terminalCommandRefresh', () => ({ createTerminalCommandObserver: () => ({ accept: vi.fn(), dispose: vi.fn() }) }))
vi.mock('@/lib/agentResumeRestore', () => ({
  shouldResumeAfterLoss: () => true,
  startAgentResume: vi.fn(async () => false),
  terminalStatusLine: () => '',
}))
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ clearRestoredBigTerminalStatus: vi.fn() }) } }))
vi.mock('../bigTerminalInitialInput', () => ({ writeInitialAgentInput: vi.fn() }))

import { connectBigTerminal } from '../bigTerminalConnect'
import type { BigTermEntry } from '../bigTerminalCache'

function entry(): BigTermEntry {
  return {
    terminalId: 'bt-1', worktreePath: '/repo', disposed: false, ptyId: null,
    term: { write: vi.fn(), onData: vi.fn(), rows: 24 },
  } as unknown as BigTermEntry
}

describe('connectBigTerminal: background warm-up', () => {
  beforeEach(() => { vi.clearAllMocks(); pty.reattach.mockResolvedValue(null) })

  it('spawns nothing when the session died and the warm-up drops the terminal', async () => {
    const onReattachFailed = vi.fn(() => true)
    await connectBigTerminal(entry(), { onReattachFailed })
    expect(onReattachFailed).toHaveBeenCalledOnce()
    expect(pty.spawn).not.toHaveBeenCalled()
    expect(pty.readScrollback).not.toHaveBeenCalled()
  })

  it('restores normally when the tab was opened meanwhile (warm-up keeps it)', async () => {
    await connectBigTerminal(entry(), { onReattachFailed: () => false })
    expect(pty.spawn).toHaveBeenCalledOnce()
  })

  it('never asks when the live session reattached', async () => {
    pty.reattach.mockResolvedValue({ sessionId: 'bt-1', snapshot: 'x' })
    const onReattachFailed = vi.fn(() => true)
    await connectBigTerminal(entry(), { onReattachFailed })
    expect(onReattachFailed).not.toHaveBeenCalled()
  })
})
