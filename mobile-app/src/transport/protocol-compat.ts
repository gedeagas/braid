// Mirror of `src/shared/mobile-compat.ts` (the canonical, CI-tested copy). Metro
// can't resolve outside `mobile-app/`, so the evaluator is duplicated here bound
// to the local mobile constants. Keep the logic in sync with the shared copy.
import { MIN_COMPATIBLE_DESKTOP_VERSION, MOBILE_PROTOCOL_VERSION } from './protocol-version';
import type { BraidStatus } from './types';

export type CompatVerdict =
  | { kind: 'ok' }
  | {
      kind: 'blocked';
      reason: 'mobile-too-old' | 'desktop-too-old';
      desktopVersion: number;
      requiredMobileVersion?: number;
      requiredDesktopVersion?: number;
    };

/** Evaluate this mobile build against a desktop's advertised `status.get` fields. */
export function evaluateCompat(input: {
  desktopProtocolVersion: number | undefined;
  desktopMinCompatibleMobileVersion: number | undefined;
}): CompatVerdict {
  // Absent fields -> 0, so a pre-versioning desktop reads as protocol 0.
  const desktopVersion = input.desktopProtocolVersion ?? 0;
  const requiredMobile = input.desktopMinCompatibleMobileVersion ?? 0;

  // Desktop kill switch wins: an explicit "I refuse this mobile build" is
  // decisive. A newer desktop otherwise stays compatible - additive features are
  // capability-gated, so a higher protocol version alone never blocks.
  if (MOBILE_PROTOCOL_VERSION < requiredMobile) {
    return { kind: 'blocked', reason: 'mobile-too-old', desktopVersion, requiredMobileVersion: requiredMobile };
  }
  if (desktopVersion < MIN_COMPATIBLE_DESKTOP_VERSION) {
    return { kind: 'blocked', reason: 'desktop-too-old', desktopVersion, requiredDesktopVersion: MIN_COMPATIBLE_DESKTOP_VERSION };
  }
  return { kind: 'ok' };
}

/** Convenience: evaluate straight from a `status.get` result (or null/undefined). */
export function evaluateCompatFromStatus(status: BraidStatus | null | undefined): CompatVerdict {
  return evaluateCompat({
    desktopProtocolVersion: status?.protocolVersion,
    desktopMinCompatibleMobileVersion: status?.minCompatibleMobileVersion,
  });
}

/** True if the desktop advertised the given capability id in `status.get`. */
export function desktopSupports(status: BraidStatus | null | undefined, capability: string): boolean {
  return status?.capabilities?.includes(capability) ?? false;
}
