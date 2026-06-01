/**
 * Mobile app feature flags.
 */

/**
 * @deprecated The SDK-chat "session" screens are deprecated. Braid Mobile is
 * consolidating on the terminal screen (`src/app/terminal/[hostId].tsx`) as the
 * single way to drive a paired desktop.
 *
 * The session routes (`src/app/sessions/[hostId].tsx`,
 * `src/app/session/[hostId]/[sessionId].tsx`) still exist for backward-compatible
 * deep links, but every UI entrypoint that navigates to them is gated behind this
 * flag. Leave it `false` unless you are intentionally restoring SDK chat. Do not
 * add new entrypoints to the session routes; target the terminal screen and the
 * `terminal.*` RPCs instead of `sessions.*` / `agent.*`.
 */
export const SESSION_SCREENS_ENABLED = false;
