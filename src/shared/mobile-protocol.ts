/** Mobile companion server protocol constants. */

// The protocol version gates BREAKING changes only. Additive, backward-safe
// features are gated by capability strings (see MOBILE_CAPABILITIES below), not
// by bumping this number - that keeps a newer desktop compatible with an older
// mobile build that simply doesn't use the new feature.
//
// Bump MOBILE_PROTOCOL_VERSION when:
//   - You remove an RPC method or a required param mobile uses.
//   - You change the meaning (units, nullability) of a field mobile reads.
//   - You change encrypted framing, terminal stream framing, or the auth handshake.
// Do NOT bump for:
//   - Adding a new RPC method, a new optional field, or a new ignorable event.
//   - Adding a capability-negotiated feature (add a capability id instead).
//
// Bump MIN_COMPATIBLE_MOBILE_VERSION (the desktop-side kill switch) only when an
// old mobile build can no longer talk to this desktop safely - it hard-blocks
// those clients via the compatibility verdict.
export const MOBILE_PROTOCOL_VERSION = 4
export const MIN_COMPATIBLE_MOBILE_VERSION = 1
export const DEFAULT_MOBILE_PORT = 6839

// Capability ids advertised by the desktop in `status.get`. Each is an additive,
// negotiable feature; mobile checks for the string instead of inferring support
// from the protocol version. Append new ids here as features ship; never reuse
// or renumber an existing id.
export const MOBILE_CAPABILITIES = [
  'notifications.v1', // notifications.subscribe / notifications.unsubscribe (was "v2")
  'terminal.binary-stream.v1', // binary PTY output channel (was "v3")
  'terminal.subscribe-snapshot.v1', // scrollback snapshot returned in terminal.subscribe result
  'terminal.presence.v1', // terminal.presence RPC: is a terminal open on the desktop / another device
  'github.pr-status.v1', // github.prStatus RPC: per-worktree PR state (open/merged/closed) when gh CLI is available
] as const

export type MobileCapability = (typeof MOBILE_CAPABILITIES)[number] | (string & {})
