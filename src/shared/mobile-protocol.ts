/** Mobile companion server protocol constants. */

// v2: adds `notifications.subscribe` / `notifications.unsubscribe` for pushing
// agent done/error/waiting notifications to paired devices over the WS.
export const MOBILE_PROTOCOL_VERSION = 2
export const MIN_COMPATIBLE_MOBILE_VERSION = 1
export const DEFAULT_MOBILE_PORT = 6839
