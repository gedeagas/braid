// What the terminal backend supports (`pty:getFeatures`, the daemon's hello
// features). Branch on these, never on app version: after an app update the
// previous build's daemon keeps serving the open terminals (legacy mode) until
// it has none left.
//
// With headless-snapshot + status-events ("offload"): hidden terminals get no
// output, they are restored from a snapshot when shown, and agent status comes
// from the daemon. Otherwise everything works as before.

import * as ipc from '@/lib/ipc'
import { OFFLOAD_FEATURES } from '@shared/terminal-offload'

let features: readonly string[] = []
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: readonly string[]): void {
  features = Array.isArray(next) ? [...next] : []
  for (const l of listeners) l()
}

/** Load the features once and follow changes (daemon reconnect). */
export function initPtyFeatures(): Promise<void> {
  if (loading) return loading
  let p: Promise<void>
  try {
    ipc.pty.onFeaturesChanged(set)
    p = ipc.pty.getFeatures().then(set, () => set([]))
  } catch {
    // No backend (tests, early startup): no features, i.e. legacy behavior.
    p = Promise.resolve()
  }
  loading = p
  return p
}

export function hasPtyFeature(feature: string): boolean {
  return features.includes(feature)
}

/** The daemon keeps hidden terminals' screens and reports agent status. */
export function isOffloadEnabled(): boolean {
  return OFFLOAD_FEATURES.every((f) => features.includes(f))
}

export function onPtyFeaturesChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setPtyFeaturesForTests(next: readonly string[]): void {
  loading = Promise.resolve()
  set(next)
}
