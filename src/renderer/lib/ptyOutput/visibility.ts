// Tells main which terminals the user can see (`pty:setVisible`). Main serves
// visible terminals first. A terminal main has not heard about counts as
// visible, so a hidden one must be reported as soon as its PTY id is known.
//
// Targets are right-panel tabs and big-terminal entries: anything with a
// (possibly not yet known) ptyId and a `shown` flag.

import * as ipc from '@/lib/ipc'

export interface ShowTarget {
  ptyId: string | null
  /** Undefined = never shown. */
  shown?: boolean
}

export type ShowListener = (target: ShowTarget, shown: boolean) => void

const reported = new Map<string, boolean>()
const listeners = new Set<ShowListener>()

function report(ptyId: string, shown: boolean): void {
  if (reported.get(ptyId) === shown) return
  reported.set(ptyId, shown)
  ipc.pty.setVisible(ptyId, shown)
}

/** Subscribe to show/hide transitions (WebGL pool, snapshot reveal). */
export function onShowChange(listener: ShowListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Mark a terminal shown or hidden. */
export function setShown(target: ShowTarget, shown: boolean): void {
  const changed = (target.shown === true) !== shown
  target.shown = shown
  if (target.ptyId) report(target.ptyId, shown)
  if (changed) for (const l of listeners) l(target, shown)
}

/** Report the current state once the PTY id is known (after spawn/reattach). */
export function syncShown(target: ShowTarget): void {
  if (target.ptyId) report(target.ptyId, target.shown === true)
}

/** The PTY ended or the terminal was disposed. */
export function forgetShown(ptyId: string): void {
  reported.delete(ptyId)
}

export function resetVisibilityForTests(): void {
  reported.clear()
  listeners.clear()
}
