import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PauseValve, PAUSE_SAFETY_TIMEOUT_MS } from '../delivery/pauseValve'

describe('PauseValve', () => {
  const pty = { pause: vi.fn(), resume: vi.fn() }
  let valve: PauseValve

  beforeEach(() => {
    vi.useFakeTimers()
    pty.pause.mockClear()
    pty.resume.mockClear()
    valve = new PauseValve((id) => (id === 's1' ? pty : undefined))
  })
  afterEach(() => { valve.dispose(); vi.useRealTimers() })

  it('pauses once and resumes when the owner asks', () => {
    valve.pause('s1', 'clientA')
    valve.pause('s1', 'clientA')
    expect(pty.pause).toHaveBeenCalledTimes(1)
    expect(valve.isPaused('s1')).toBe(true)
    valve.resume('s1', 'clientA')
    expect(pty.resume).toHaveBeenCalledTimes(1)
    expect(valve.isPaused('s1')).toBe(false)
  })

  it('stays paused until every owner resumed', () => {
    valve.pause('s1', 'clientA')
    valve.pause('s1', 'clientB')
    valve.resume('s1', 'clientA')
    expect(pty.resume).not.toHaveBeenCalled()
    valve.resume('s1', 'clientB')
    expect(pty.resume).toHaveBeenCalledTimes(1)
  })

  it('resumes on its own 10s after the last pause', () => {
    expect(PAUSE_SAFETY_TIMEOUT_MS).toBe(10_000)
    valve.pause('s1', 'clientA')
    vi.advanceTimersByTime(6_000)
    valve.pause('s1', 'clientA') // re-sent pause restarts the clock
    vi.advanceTimersByTime(9_999)
    expect(pty.resume).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(pty.resume).toHaveBeenCalledTimes(1)
    expect(valve.isPaused('s1')).toBe(false)
  })

  it('resumes every session a disconnected client paused', () => {
    valve.pause('s1', 'clientA')
    valve.releaseOwner('clientA')
    expect(pty.resume).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(20_000)
    expect(pty.resume).toHaveBeenCalledTimes(1)
  })

  it('ignores resume from an owner that never paused', () => {
    valve.resume('s1', 'clientA')
    expect(pty.resume).not.toHaveBeenCalled()
  })

  it('ignores unknown sessions', () => {
    valve.pause('nope', 'clientA')
    expect(valve.isPaused('nope')).toBe(false)
  })

  it('drops a session that ended without touching its PTY', () => {
    valve.pause('s1', 'clientA')
    valve.forget('s1')
    vi.advanceTimersByTime(20_000)
    expect(pty.resume).not.toHaveBeenCalled()
  })
})
