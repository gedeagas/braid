// Routes `pty:data` to the xterm that displays each PTY: right-panel tabs and
// big terminals (through finders), plus terminals registered for a single PTY
// (setup panel). One subscription for the whole app, so every chunk is
// acknowledged exactly once - including output no terminal displays, which is
// acked right away so main's flow control never waits on it.

import * as ipc from '@/lib/ipc'
import { forgetAcks, markProcessed, writeToTerminal, type WritableTerminal } from './writeOutput'
import { forgetReveal, holdWhileAwaiting, writeWithoutReplies } from './reveal'

export type PtyFinder = (ptyId: string) => WritableTerminal | undefined

const finders: PtyFinder[] = []
const direct = new Map<string, WritableTerminal>()
let initialized = false

export function registerPtyFinder(finder: PtyFinder): void {
  finders.push(finder)
}

/** Route one PTY's output to `term`. Returns an unregister function. */
export function registerPtyTerminal(ptyId: string, term: WritableTerminal): () => void {
  direct.set(ptyId, term)
  return () => {
    if (direct.get(ptyId) === term) direct.delete(ptyId)
  }
}

export function findPtyTerminal(ptyId: string): WritableTerminal | undefined {
  const registered = direct.get(ptyId)
  if (registered) return registered
  for (const finder of finders) {
    const found = finder(ptyId)
    if (found) return found
  }
  return undefined
}

/**
 * `noReply`: the daemon answers this output's terminal queries (it was
 * produced around a show), so xterm must not reply to them too.
 */
export function routePtyOutput(ptyId: string, data: string, noReply = false): void {
  // A snapshot was requested: keep it aside (acked now, written later only if
  // no snapshot replaces the screen).
  if (holdWhileAwaiting(ptyId, data, noReply)) {
    markProcessed(ptyId, data.length)
    return
  }
  const term = findPtyTerminal(ptyId)
  if (!term) markProcessed(ptyId, data.length)
  else if (noReply) writeWithoutReplies(ptyId, term, data, () => markProcessed(ptyId, data.length))
  else writeToTerminal(term, data, { ptyId })
}

/** Subscribe to pty:data once. Safe to call from every terminal owner. */
export function initPtyOutputRouting(): void {
  if (initialized) return
  initialized = true
  ipc.pty.onData(routePtyOutput)
  // Main drops its counts when a PTY ends; drop ours too, so an id that is
  // reused (a big terminal respawned after hibernation) restarts at zero.
  ipc.pty.onExit((id) => {
    forgetAcks(id)
    forgetReveal(id)
  })
  // Main sends (and counts) nothing until this listener is known to exist.
  ipc.pty.rendererReady()
}
