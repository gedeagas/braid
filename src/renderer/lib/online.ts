/**
 * Reactive online/offline state tracker.
 *
 * Uses `navigator.onLine` + browser events. When offline, polling loops
 * can skip IPC calls that would spawn `gh`/`acli` processes only to
 * timeout after 15s.
 *
 * Provides `onOnline()` / `onOffline()` to register callbacks that fire
 * on connectivity transitions, and `useOnlineStatus()` for reactive React UI.
 */

import { useSyncExternalStore } from 'react'

let _online = typeof navigator !== 'undefined' ? navigator.onLine : true

const _onlineCallbacks = new Set<() => void>()
const _offlineCallbacks = new Set<() => void>()

/** Subscribers for useSyncExternalStore */
const _storeListeners = new Set<() => void>()

function notifyStoreListeners(): void {
  for (const cb of _storeListeners) cb()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    _online = true
    notifyStoreListeners()
    for (const cb of _onlineCallbacks) cb()
  })
  window.addEventListener('offline', () => {
    _online = false
    notifyStoreListeners()
    for (const cb of _offlineCallbacks) cb()
  })
}

/** Returns true when the browser believes we have network connectivity. */
export function isOnline(): boolean {
  return _online
}

/**
 * Register a callback that fires when the browser transitions from offline -> online.
 * Returns an unsubscribe function.
 */
export function onOnline(cb: () => void): () => void {
  _onlineCallbacks.add(cb)
  return () => { _onlineCallbacks.delete(cb) }
}

/**
 * Register a callback that fires when the browser transitions from online -> offline.
 * Returns an unsubscribe function.
 */
export function onOffline(cb: () => void): () => void {
  _offlineCallbacks.add(cb)
  return () => { _offlineCallbacks.delete(cb) }
}

function subscribeOnlineStore(listener: () => void): () => void {
  _storeListeners.add(listener)
  return () => { _storeListeners.delete(listener) }
}

function getOnlineSnapshot(): boolean {
  return _online
}

/**
 * React hook that returns the current online status and re-renders on change.
 * Uses `useSyncExternalStore` for tear-free reads.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnlineStore, getOnlineSnapshot, () => true)
}
