// Pure mobile<->desktop protocol compatibility evaluator. All version numbers are
// passed in (no module constants) so the logic is dependency-free and can be
// duplicated verbatim inside the Expo app, which can't resolve outside its own
// tree. This file is the canonical, CI-tested copy; the mirror lives at
// `mobile-app/src/transport/protocol-compat.ts` - keep the logic in sync.

export type MobileCompatVerdict =
  | { kind: 'ok' }
  | {
      kind: 'blocked'
      reason: 'mobile-too-old' | 'desktop-too-old'
      desktopVersion: number
      requiredMobileVersion?: number
      requiredDesktopVersion?: number
    }

export function evaluateMobileCompat(input: {
  /** This mobile build's protocol version. */
  mobileProtocolVersion: number
  /** Oldest desktop protocol this mobile build will talk to. */
  minCompatibleDesktopVersion: number
  /** Desktop's reported protocol version (absent on pre-versioning desktops). */
  desktopProtocolVersion: number | undefined
  /** Desktop's kill switch: oldest mobile it accepts (absent on older desktops). */
  desktopMinCompatibleMobileVersion: number | undefined
}): MobileCompatVerdict {
  // Absent fields -> 0. A new mobile build talking to a pre-versioning desktop
  // then reads desktopVersion 0 and can surface a clear "update desktop" message
  // instead of attempting partially-supported RPCs.
  const desktopVersion = input.desktopProtocolVersion ?? 0
  const requiredMobile = input.desktopMinCompatibleMobileVersion ?? 0

  // The desktop's kill switch wins: if the desktop refuses this mobile build,
  // that's decisive over any local judgment about the desktop's age. A newer
  // desktop is otherwise fine - additive features are capability-gated, so it
  // never blocks merely for reporting a higher protocol version.
  if (input.mobileProtocolVersion < requiredMobile) {
    return {
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion,
      requiredMobileVersion: requiredMobile,
    }
  }
  if (desktopVersion < input.minCompatibleDesktopVersion) {
    return {
      kind: 'blocked',
      reason: 'desktop-too-old',
      desktopVersion,
      requiredDesktopVersion: input.minCompatibleDesktopVersion,
    }
  }
  return { kind: 'ok' }
}

/** True if `capabilities` (as advertised by the desktop) includes `capability`. */
export function hasMobileCapability(capabilities: readonly string[] | undefined, capability: string): boolean {
  return capabilities?.includes(capability) ?? false
}
