// Mobile client's protocol constants. Duplicates the desktop's
// `src/shared/mobile-protocol.ts` because Metro/Expo can't resolve outside
// `mobile-app/`. Manual sync is acceptable - these bump rarely.
//
// The protocol version gates BREAKING changes only; additive features are gated
// by capability ids (see MOBILE_CAPABILITY below), not by this number.
//
// Bump MOBILE_PROTOCOL_VERSION when:
//   - You change the meaning of an RPC mobile sends, or
//   - You stop relying on a server feature in a way old servers would notice.
// Do NOT bump for additive changes (new optional request/response fields).
//
// Bump MIN_COMPATIBLE_DESKTOP_VERSION only when mobile starts requiring a server
// feature added at a specific protocol version - it hard-blocks older desktops.
export const MOBILE_PROTOCOL_VERSION = 4;
export const MIN_COMPATIBLE_DESKTOP_VERSION = 1;

// Capability ids the desktop advertises in `status.get`. Gate features on these
// instead of the protocol version. Mirror of MOBILE_CAPABILITIES on the desktop.
export const MOBILE_CAPABILITY = {
  notifications: 'notifications.v1',
  binaryTerminalStream: 'terminal.binary-stream.v1',
  subscribeSnapshot: 'terminal.subscribe-snapshot.v1',
  terminalPresence: 'terminal.presence.v1',
  githubPrStatus: 'github.pr-status.v1',
} as const;
