// v2: adds notifications.subscribe / notifications.unsubscribe. Kept in lockstep
// with src/shared/mobile-protocol.ts on the desktop side.
export const MOBILE_PROTOCOL_VERSION = 2;
// Still compatible with v1 desktops - they simply won't push notifications.
export const MIN_COMPATIBLE_DESKTOP_VERSION = 1;

export function compatibilityVerdict(desktopVersion?: number): 'ok' | 'desktop-too-old' | 'mobile-too-old' | 'unknown' {
  if (!desktopVersion) return 'unknown';
  if (desktopVersion < MIN_COMPATIBLE_DESKTOP_VERSION) return 'desktop-too-old';
  if (desktopVersion > MOBILE_PROTOCOL_VERSION) return 'mobile-too-old';
  return 'ok';
}
