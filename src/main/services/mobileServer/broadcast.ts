import type { JsonRpcNotification } from './types'

/**
 * Broadcast registry for pushing a JSON-RPC notification to every connected
 * mobile device (optionally excluding the originator).
 *
 * Lives in its own module so callers that need to broadcast (e.g. the RPC
 * handlers in `rpc.ts` and the PTY IPC handlers in `main/ipc.ts`) can do so
 * without importing `mobileServer.ts` directly - which would create an import
 * cycle (mobileServer -> rpc -> mobileServer). The MobileServer registers its
 * broadcast function here at construction time.
 */
type Broadcaster = (notification: JsonRpcNotification, exceptDeviceId?: string) => void

let broadcaster: Broadcaster | null = null

export function setMobileBroadcaster(fn: Broadcaster | null): void {
  broadcaster = fn
}

export function broadcastMobileNotification(
  notification: JsonRpcNotification,
  exceptDeviceId?: string,
): void {
  broadcaster?.(notification, exceptDeviceId)
}
