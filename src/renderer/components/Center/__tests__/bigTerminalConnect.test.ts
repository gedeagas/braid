import { describe, it, expect, vi, beforeEach } from 'vitest'

const pty = vi.hoisted(() => ({
  reattach: vi.fn(),
  readScrollback: vi.fn(async () => ''),
  spawn: vi.fn(async () => 'pty-1'),
  registerBigTerminal: vi.fn(),
  write: vi.fn(),
  consumeColdRestore: vi.fn(async () => false),
  setVisible: vi.fn(),
  setDeliveryInterest: vi.fn(),
}))
vi.mock('@/lib/ipc', () => ({ pty }))
vi.mock('@/lib/terminalCommandRefresh', () => ({ createTerminalCommandObserver: () => ({ accept: vi.fn(), dispose: vi.fn() }) }))
vi.mock('@/lib/agentResumeRestore', () => ({
  shouldResumeAfterLoss: () => true,
  startAgentResume: vi.fn(async () => false),
  terminalStatusLine: () => '',
}))
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ clearRestoredBigTerminalStatus: vi.fn() }) } }))
vi.mock('../bigTerminalInitialInput', () => ({ writeInitialAgentInput: vi.fn(), typeInitialCommand: vi.fn() }))
const reveal = vi.hoisted(() => ({ revealTerminal: vi.fn(async () => true), setReplyGuard: vi.fn() }))
vi.mock('@/lib/ptyOutput/reveal', () => reveal)
const features = vi.hoisted(() => ({ offload: false }))
vi.mock('@/lib/ptyFeatures', () => ({ initPtyFeatures: async () => {}, isOffloadEnabled: () => features.offload }))

import { connectBigTerminal } from '../bigTerminalConnect'
import { POST_REPLAY_MODE_RESET } from '@/lib/replayGuard'
import { resetVisibilityForTests } from '@/lib/ptyOutput/visibility'
import type { BigTermEntry } from '../bigTerminalCache'

function entry(): BigTermEntry {
  return {
    terminalId: 'bt-1', worktreePath: '/repo', disposed: false, ptyId: null,
    term: { write: vi.fn(), onData: vi.fn(), rows: 24 },
  } as unknown as BigTermEntry
}

describe('connectBigTerminal: background warm-up', () => {
  beforeEach(() => { vi.clearAllMocks(); features.offload = false; pty.reattach.mockResolvedValue(null) })

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

describe('connectBigTerminal: reattach after an app update', () => {
  beforeEach(() => { vi.clearAllMocks(); resetVisibilityForTests(); features.offload = false })

  it('with an older daemon (no features) replays the raw snapshot and resets stale modes', async () => {
    pty.reattach.mockResolvedValue({ sessionId: 'bt-1', snapshot: 'raw ring buffer' })
    const e = entry()
    await connectBigTerminal(e, {})
    expect(pty.reattach).toHaveBeenCalledWith('bt-1', undefined)
    const written = (e.term.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(written[0]).toBe('raw ring buffer')
    expect(written).toContain(POST_REPLAY_MODE_RESET)
    expect(reveal.revealTerminal).not.toHaveBeenCalled()
  })

  it('with a capable daemon restores the headless snapshot instead (exact modes, no mode reset)', async () => {
    features.offload = true
    pty.reattach.mockResolvedValue({ sessionId: 'bt-1', snapshot: '' })
    const e = entry()
    await connectBigTerminal(e, {})
    expect(pty.reattach).toHaveBeenCalledWith('bt-1', { snapshot: false })
    expect(reveal.revealTerminal).toHaveBeenCalledWith(expect.objectContaining({ ptyId: 'bt-1', guardId: 'bt-1' }))
    const written = (e.term.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(written).not.toContain(POST_REPLAY_MODE_RESET)
    // Nothing after the program's exact screen: a banner would move its cursor.
    expect(written).toEqual([])
    expect(reveal.setReplyGuard).toHaveBeenCalledWith('bt-1', 'bt-1')
    expect(e.ptyId).toBe('bt-1')
    expect(pty.spawn).not.toHaveBeenCalled()
    // Main treats an unreported terminal as visible: a hidden one says so.
    expect(pty.setVisible).toHaveBeenCalledWith('bt-1', false)
  })

  it('keeps the cold-restore claim and agent resume flow', async () => {
    features.offload = true
    pty.reattach.mockResolvedValue({ sessionId: 'bt-1', snapshot: '', coldRestored: true })
    pty.consumeColdRestore.mockResolvedValue(true)
    const { startAgentResume } = await import('@/lib/agentResumeRestore')
    await connectBigTerminal(entry(), {})
    expect(pty.consumeColdRestore).toHaveBeenCalledWith('bt-1')
    expect(startAgentResume).toHaveBeenCalled()
  })
})
