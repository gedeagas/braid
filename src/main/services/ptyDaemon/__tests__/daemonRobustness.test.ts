import { describe, it, expect } from 'vitest'
import { RespawnThrottle, shouldReplaceDaemon } from '../lifecycle'

describe('RespawnThrottle', () => {
  it('allows 5 daemon spawns per minute, then refuses until the window slides', () => {
    let now = 0
    const throttle = new RespawnThrottle(5, 60_000, () => now)
    for (let i = 0; i < 5; i++) {
      expect(throttle.tryAcquire()).toBe(true)
      now += 1_000
    }
    expect(throttle.tryAcquire()).toBe(false)
    now = 60_001
    expect(throttle.tryAcquire()).toBe(true)
  })
})

describe('shouldReplaceDaemon', () => {
  it('keeps a matching daemon', () => {
    expect(shouldReplaceDaemon({ running: '26.4.0', expected: '26.4.0', sessionCount: 0 })).toBe(false)
  })

  it('replaces an outdated (or pre-versioning) daemon only when it holds no sessions', () => {
    expect(shouldReplaceDaemon({ running: '26.3.3', expected: '26.4.0', sessionCount: 0 })).toBe(true)
    expect(shouldReplaceDaemon({ running: undefined, expected: '26.4.0', sessionCount: 0 })).toBe(true)
  })

  it('never replaces a daemon that is running sessions (no duplicates, no killed agents)', () => {
    expect(shouldReplaceDaemon({ running: '26.3.3', expected: '26.4.0', sessionCount: 3 })).toBe(false)
  })

  it('never replaces a daemon from a newer build (downgrade)', () => {
    expect(shouldReplaceDaemon({ running: '27.0.0', expected: '26.4.0', sessionCount: 0 })).toBe(false)
  })
})
