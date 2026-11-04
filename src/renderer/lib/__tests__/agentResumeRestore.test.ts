import { describe, it, expect, vi, beforeEach } from 'vitest'

const setBigTerminalResumeSession = vi.fn()
let hookListener: ((update: unknown) => void) | null = null
let tabsByWorktree: Record<string, unknown[]> = {}

vi.mock('@/store/ui', () => ({
  useUIStore: {
    getState: () => ({ bigTerminalsByWorktree: tabsByWorktree, setBigTerminalResumeSession }),
  },
}))

vi.mock('@/lib/ipc', () => ({
  pty: {
    onAgentHookSession: (cb: (update: unknown) => void) => {
      hookListener = cb
      return () => { hookListener = null }
    },
  },
}))

import { blankViewportSequence, coldRestoreResumeCommand, initAgentSessionTracking, startAgentResume } from '../agentResumeRestore'

describe('coldRestoreResumeCommand', () => {
  beforeEach(() => {
    tabsByWorktree = {}
  })

  it('builds the resume command for a tab with a saved session', () => {
    tabsByWorktree = { 'wt-1': [{ id: 'bt-1', label: 'Claude', agentId: 'claude', resume: { agent: 'claude', id: 'S1' } }] }
    expect(coldRestoreResumeCommand('bt-1', '/repo')).toEqual({ command: "claude --resume 'S1'", label: 'Claude Code' })
  })

  it('uses the agent that reported the session, not the tab agent', () => {
    // A plain terminal where the user started codex by hand.
    tabsByWorktree = { 'wt-1': [{ id: 'bt-1', label: 'Terminal 1', resume: { agent: 'codex', id: 'S9' } }] }
    expect(coldRestoreResumeCommand('bt-1', '/repo')?.command).toBe("codex resume 'S9'")
  })

  it('keeps catalog base flags (hermes --tui)', () => {
    tabsByWorktree = { 'wt-1': [{ id: 'bt-1', label: 'Hermes', resume: { agent: 'hermes', id: 'h1' } }] }
    expect(coldRestoreResumeCommand('bt-1', '/repo')?.command).toBe("hermes --tui --resume 'h1'")
  })

  it('returns null without a saved session or for unknown tabs', () => {
    tabsByWorktree = { 'wt-1': [{ id: 'bt-1', label: 'Claude', agentId: 'claude' }] }
    expect(coldRestoreResumeCommand('bt-1', '/repo')).toBeNull()
    expect(coldRestoreResumeCommand('bt-404', '/repo')).toBeNull()
  })
})

describe('initAgentSessionTracking', () => {
  it('routes hook session updates into the store, and unsubscribes', () => {
    const stop = initAgentSessionTracking()
    hookListener?.({ terminalId: 'bt-1', session: { agent: 'claude', id: 'S1' } })
    expect(setBigTerminalResumeSession).toHaveBeenCalledWith('bt-1', { agent: 'claude', id: 'S1' })
    hookListener?.({ terminalId: 'bt-1', session: null })
    expect(setBigTerminalResumeSession).toHaveBeenLastCalledWith('bt-1', null)
    stop()
    expect(hookListener).toBeNull()
  })

  it('re-validates updates from IPC and drops malformed ones', () => {
    setBigTerminalResumeSession.mockClear()
    initAgentSessionTracking()
    hookListener?.({ terminalId: 'bt-1', session: { agent: 'claude', id: '$(id)' } })
    hookListener?.({ session: null })
    expect(setBigTerminalResumeSession).not.toHaveBeenCalled()
  })
})

describe('blankViewportSequence', () => {
  it('scrolls one screen of history up and homes the cursor', () => {
    expect(blankViewportSequence(3)).toBe('\r\n\r\n\r\n\x1b[H')
  })

  it('clamps nonsense sizes', () => {
    expect(blankViewportSequence(0)).toBe('\r\n'.repeat(24) + '\x1b[H')
    expect(blankViewportSequence(Number.NaN)).toBe('\r\n'.repeat(24) + '\x1b[H')
    expect(blankViewportSequence(10_000).length).toBe(500 * 2 + 3)
  })
})

describe('startAgentResume', () => {
  beforeEach(() => {
    tabsByWorktree = {}
  })

  it('blanks the viewport, then runs the resume command once', () => {
    tabsByWorktree = { 'wt-1': [{ id: 'bt-1', label: 'Claude', resume: { agent: 'claude', id: 'S1' } }] }
    const painted: string[] = []
    const ran: string[] = []
    const started = startAgentResume({ terminalId: 'bt-1', worktreePath: '/repo', rows: 2, paint: (d) => painted.push(d), run: (c) => ran.push(c) })
    expect(started).toBe(true)
    expect(painted[0]).toBe('\r\n\r\n\x1b[H')
    expect(painted[1]).toContain('resuming Claude Code session')
    expect(ran).toEqual(["claude --resume 'S1'\n"])
  })

  it('does nothing without a saved session', () => {
    tabsByWorktree = { 'wt-1': [{ id: 'bt-1', label: 'Terminal' }] }
    const paint = vi.fn()
    const run = vi.fn()
    expect(startAgentResume({ terminalId: 'bt-1', worktreePath: '/repo', rows: 24, paint, run })).toBe(false)
    expect(paint).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
