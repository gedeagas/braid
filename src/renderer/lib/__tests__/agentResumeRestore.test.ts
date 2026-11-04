import { describe, it, expect, vi, beforeEach } from 'vitest'

const claimAgentResume = vi.fn()

vi.mock('@/lib/ipc', () => ({
  pty: { claimAgentResume: (id: string) => claimAgentResume(id) },
}))

import { blankViewportSequence, claimResumeCommand, startAgentResume } from '../agentResumeRestore'

beforeEach(() => {
  claimAgentResume.mockReset()
})

describe('claimResumeCommand', () => {
  it('builds the resume command for the claimed session', async () => {
    claimAgentResume.mockResolvedValue({ agent: 'claude', id: 'S1' })
    expect(await claimResumeCommand('bt-1', '/repo')).toEqual({ command: "claude --resume 'S1'", label: 'Claude Code' })
    expect(claimAgentResume).toHaveBeenCalledWith('bt-1')
  })

  it('uses the agent that reported the session (user started codex by hand)', async () => {
    claimAgentResume.mockResolvedValue({ agent: 'codex', id: 'S9' })
    expect((await claimResumeCommand('bt-1', '/repo'))?.command).toBe("codex resume 'S9'")
  })

  it('keeps catalog base flags (hermes --tui)', async () => {
    claimAgentResume.mockResolvedValue({ agent: 'hermes', id: 'h1' })
    expect((await claimResumeCommand('bt-1', '/repo'))?.command).toBe("hermes --tui --resume 'h1'")
  })

  it('returns null when nothing is claimed, the IPC fails, or the payload is unsafe', async () => {
    claimAgentResume.mockResolvedValue(null)
    expect(await claimResumeCommand('bt-1', '/repo')).toBeNull()
    claimAgentResume.mockRejectedValue(new Error('no handler'))
    expect(await claimResumeCommand('bt-1', '/repo')).toBeNull()
    claimAgentResume.mockResolvedValue({ agent: 'claude', id: '$(id)' })
    expect(await claimResumeCommand('bt-1', '/repo')).toBeNull()
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
  it('blanks the viewport, then runs the resume command once', async () => {
    claimAgentResume.mockResolvedValue({ agent: 'claude', id: 'S1' })
    const painted: string[] = []
    const ran: string[] = []
    const started = await startAgentResume({ terminalId: 'bt-1', worktreePath: '/repo', rows: 2, paint: (d) => painted.push(d), run: (c) => ran.push(c) })
    expect(started).toBe(true)
    expect(painted[0]).toBe('\r\n\r\n\x1b[H')
    expect(painted[1]).toContain('resuming Claude Code session')
    expect(ran).toEqual(["claude --resume 'S1'\n"])
  })

  it('does nothing without a saved session', async () => {
    claimAgentResume.mockResolvedValue(null)
    const paint = vi.fn()
    const run = vi.fn()
    expect(await startAgentResume({ terminalId: 'bt-1', worktreePath: '/repo', rows: 24, paint, run })).toBe(false)
    expect(paint).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('does nothing if the terminal was disposed while claiming', async () => {
    claimAgentResume.mockResolvedValue({ agent: 'claude', id: 'S1' })
    const run = vi.fn()
    expect(await startAgentResume({ terminalId: 'bt-1', worktreePath: '/repo', rows: 24, paint: vi.fn(), run, isAlive: () => false })).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
