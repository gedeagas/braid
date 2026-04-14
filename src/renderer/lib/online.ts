/**
 * Reactive online/offline state tracker.
 *
 * Uses `navigator.onLine` + browser events. When offline, polling loops
 * can skip IPC calls that would spawn `gh`/`acli` processes only to
 * timeout after 15s.
 *
 * Also provides `onOnline()` to register callbacks that fire when
 * connectivity is restored (e.g. trigger an immediate refresh).
 */

let _online = typeof navigator !== 'undefined' ? navigator.onLine : true

const _onlineCallbacks = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    _online = true
    for (const cb of _onlineCallbacks) cb()
  })
  window.addEventListener('offline', () => {
    _online = false
  })
}

/** Returns true when the browser believes we have network connectivity. */
export function isOnline(): boolean {
  return _online
}

/**
 * Register a callback that fires when the browser transitions from offline → online.
 * Returns an unsubscribe function.
 */
export function onOnline(cb: () => void): () => void {
  _onlineCallbacks.add(cb)
  return () => { _onlineCallbacks.delete(cb) }
}
