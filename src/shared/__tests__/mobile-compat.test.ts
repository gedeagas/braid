import { describe, it, expect } from 'vitest'

import { evaluateMobileCompat, hasMobileCapability } from '../mobile-compat'

describe('evaluateMobileCompat', () => {
  // Current production numbers: mobile speaks v3, accepts desktops >= v1.
  const base = { mobileProtocolVersion: 3, minCompatibleDesktopVersion: 1 }

  it('is ok when desktop reports the same protocol version', () => {
    const verdict = evaluateMobileCompat({
      ...base,
      desktopProtocolVersion: 3,
      desktopMinCompatibleMobileVersion: 1,
    })
    expect(verdict).toEqual({ kind: 'ok' })
  })

  it('does NOT block merely because the desktop is newer (additive features are capability-gated)', () => {
    // A desktop on a higher protocol with no kill switch stays compatible - this
    // is the false-positive the old `desktopVersion > MOBILE_VERSION` check caused.
    const verdict = evaluateMobileCompat({
      ...base,
      desktopProtocolVersion: 5,
      desktopMinCompatibleMobileVersion: 1,
    })
    expect(verdict.kind).toBe('ok')
  })

  it('blocks mobile-too-old when the desktop kill switch excludes this build', () => {
    const verdict = evaluateMobileCompat({
      ...base,
      desktopProtocolVersion: 5,
      desktopMinCompatibleMobileVersion: 4, // desktop refuses mobile < 4
    })
    expect(verdict).toEqual({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 4,
    })
  })

  it('blocks desktop-too-old when the desktop predates this mobile build', () => {
    const verdict = evaluateMobileCompat({
      mobileProtocolVersion: 3,
      minCompatibleDesktopVersion: 2,
      desktopProtocolVersion: 1,
      desktopMinCompatibleMobileVersion: 1,
    })
    expect(verdict).toEqual({
      kind: 'blocked',
      reason: 'desktop-too-old',
      desktopVersion: 1,
      requiredDesktopVersion: 2,
    })
  })

  it('treats absent desktop fields as protocol 0 and stays compatible at the default floor', () => {
    // Pre-versioning desktop: no protocolVersion, no kill switch. minCompatible
    // floor of 1 would block, but a real desktop always reports >= 1; the 0-floor
    // case (default config) must not false-block.
    const verdict = evaluateMobileCompat({
      mobileProtocolVersion: 3,
      minCompatibleDesktopVersion: 0,
      desktopProtocolVersion: undefined,
      desktopMinCompatibleMobileVersion: undefined,
    })
    expect(verdict.kind).toBe('ok')
  })

  it('lets the desktop kill switch win over a stale-desktop judgment', () => {
    // Both conditions trip; mobile-too-old takes precedence so the user is told
    // to update the app (the desktop's explicit refusal), not the desktop.
    const verdict = evaluateMobileCompat({
      mobileProtocolVersion: 1,
      minCompatibleDesktopVersion: 9,
      desktopProtocolVersion: 2,
      desktopMinCompatibleMobileVersion: 5,
    })
    expect(verdict.kind).toBe('blocked')
    if (verdict.kind === 'blocked') expect(verdict.reason).toBe('mobile-too-old')
  })
})

describe('hasMobileCapability', () => {
  it('returns true when the capability is advertised', () => {
    expect(hasMobileCapability(['notifications.v1', 'terminal.binary-stream.v1'], 'terminal.binary-stream.v1')).toBe(true)
  })

  it('returns false when absent or undefined', () => {
    expect(hasMobileCapability(['notifications.v1'], 'terminal.binary-stream.v1')).toBe(false)
    expect(hasMobileCapability(undefined, 'notifications.v1')).toBe(false)
  })
})
