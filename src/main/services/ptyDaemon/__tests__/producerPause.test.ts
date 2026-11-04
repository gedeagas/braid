import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProducerPause } from '../delivery/producerPause'

const limits = { high: 256, low: 32, repeatMs: 5_000 }

describe('ProducerPause (Stage B)', () => {
  let pause: ReturnType<typeof vi.fn<(id: string) => void>>
  let resume: ReturnType<typeof vi.fn<(id: string) => void>>
  let pp: ProducerPause

  beforeEach(() => {
    vi.useFakeTimers()
    pause = vi.fn<(id: string) => void>()
    resume = vi.fn<(id: string) => void>()
    pp = new ProducerPause({ pause, resume }, limits)
    pp.setEnabled(true)
  })
  afterEach(() => { pp.dispose(); vi.useRealTimers() })

  it('pauses above the high mark and resumes below the low mark', () => {
    pp.update('a', 200)
    expect(pause).not.toHaveBeenCalled()
    pp.update('a', 257)
    expect(pause).toHaveBeenCalledWith('a')
    pp.update('a', 100)
    expect(resume).not.toHaveBeenCalled()
    pp.update('a', 31)
    expect(resume).toHaveBeenCalledWith('a')
  })

  it('does not flap between the marks', () => {
    for (const q of [300, 200, 280, 100, 290, 40]) pp.update('a', q)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(resume).not.toHaveBeenCalled()
  })

  it('re-sends pause every 5s while still above the high mark', () => {
    pp.update('a', 300)
    expect(pause).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(4_999)
    expect(pause).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(pause).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(5_000)
    expect(pause).toHaveBeenCalledTimes(3)
    pp.update('a', 0)
    vi.advanceTimersByTime(20_000)
    expect(pause).toHaveBeenCalledTimes(3)
  })

  it('stays silent when the daemon does not support flow control (legacy)', () => {
    pp.setEnabled(false)
    pp.update('a', 10_000)
    vi.advanceTimersByTime(20_000)
    expect(pause).not.toHaveBeenCalled()
  })

  it('resumes everything it paused on resumeAll (renderer reload)', () => {
    pp.update('a', 300)
    pp.update('b', 300)
    pp.resumeAll()
    expect(resume).toHaveBeenCalledWith('a')
    expect(resume).toHaveBeenCalledWith('b')
    expect(pp.isPaused('a')).toBe(false)
  })

  it('forgets pause state without resuming when the daemon connection was lost', () => {
    pp.update('a', 300)
    pp.forgetAll()
    expect(resume).not.toHaveBeenCalled()
    pp.update('a', 300)
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('disabling resumes what was paused', () => {
    pp.update('a', 300)
    pp.setEnabled(false)
    expect(resume).toHaveBeenCalledWith('a')
  })
})
