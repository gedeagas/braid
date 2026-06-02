import { describe, it, expect, beforeEach } from 'vitest'

const { setMobileTerminalActor, getMobileTerminalActor, isMobileTerminalActor, clearMobileTerminalActor } = await import('../mobileTerminalActor')

describe('mobileTerminalActor', () => {
  beforeEach(() => {
    clearMobileTerminalActor('bt-1')
  })

  it('has no actor until one is claimed', () => {
    expect(getMobileTerminalActor('bt-1')).toBeUndefined()
  })

  it('treats any device as the actor while none is claimed (lone device owns its fit)', () => {
    expect(isMobileTerminalActor('bt-1', 'dev-a')).toBe(true)
    expect(isMobileTerminalActor('bt-1', 'dev-b')).toBe(true)
  })

  it('records the claiming device and yields the rest', () => {
    setMobileTerminalActor('bt-1', 'dev-a')
    expect(getMobileTerminalActor('bt-1')).toBe('dev-a')
    expect(isMobileTerminalActor('bt-1', 'dev-a')).toBe(true)
    expect(isMobileTerminalActor('bt-1', 'dev-b')).toBe(false)
  })

  it('most-recent claim wins', () => {
    setMobileTerminalActor('bt-1', 'dev-a')
    setMobileTerminalActor('bt-1', 'dev-b')
    expect(isMobileTerminalActor('bt-1', 'dev-b')).toBe(true)
    expect(isMobileTerminalActor('bt-1', 'dev-a')).toBe(false)
  })

  it('a yielding device leaving does not release the actor', () => {
    setMobileTerminalActor('bt-1', 'dev-a')
    clearMobileTerminalActor('bt-1', 'dev-b') // dev-b is not the actor
    expect(getMobileTerminalActor('bt-1')).toBe('dev-a')
  })

  it('the actor leaving frees the terminal for the next device to reclaim', () => {
    setMobileTerminalActor('bt-1', 'dev-a')
    clearMobileTerminalActor('bt-1', 'dev-a')
    expect(getMobileTerminalActor('bt-1')).toBeUndefined()
    // With no actor, the remaining device owns its fit again.
    expect(isMobileTerminalActor('bt-1', 'dev-b')).toBe(true)
  })

  it('unconditional clear removes any actor', () => {
    setMobileTerminalActor('bt-1', 'dev-a')
    clearMobileTerminalActor('bt-1')
    expect(getMobileTerminalActor('bt-1')).toBeUndefined()
  })

  it('tracks actors per terminal independently', () => {
    setMobileTerminalActor('bt-1', 'dev-a')
    setMobileTerminalActor('bt-2', 'dev-b')
    expect(isMobileTerminalActor('bt-1', 'dev-a')).toBe(true)
    expect(isMobileTerminalActor('bt-1', 'dev-b')).toBe(false)
    expect(isMobileTerminalActor('bt-2', 'dev-b')).toBe(true)
    expect(isMobileTerminalActor('bt-2', 'dev-a')).toBe(false)
    clearMobileTerminalActor('bt-2')
  })
})
