// Shows a terminal whose output main stopped sending while it was hidden (a
// daemon with headless-snapshot keeps its screen). Also used on reattach.
// No gaps, no duplicates:
//
//  1. mark the PTY as awaiting: live output that still arrives is kept aside
//  2. ask main for the snapshot; main holds newer live output meanwhile
//  3. a snapshot covers what was kept aside (main sent it before it began
//     holding), so it is dropped. Up to date or no snapshot: it is written.
//  4. let xterm finish earlier writes, term.reset(), write the snapshot under
//     the replay guard (its queries must not be answered; the daemon answers
//     the ones the snapshot covers)
//  5. confirm the snapshot's seq: main sends output newer than it

import * as ipc from '@/lib/ipc'
import { replayIntoTerminal } from '@/lib/replayGuard'
import type { WritableTerminal } from './writeOutput'
import { restoreSnapshotLinks, type LinkTerminal } from './restoredLinks'

export interface RevealTerminal extends WritableTerminal {
  cols: number
  rows: number
  reset(): void
  resize(cols: number, rows: number): void
}

export interface RevealTarget {
  ptyId: string
  /** Replay-guard id (terminal / tab id) the onData handler checks. */
  guardId: string
  term: RevealTerminal
}

/** Live output (already acknowledged) that arrived while a snapshot was requested. */
interface Held { data: string; noReply: boolean }
const awaiting = new Map<string, Held[]>()
const inFlight = new Map<string, Promise<boolean>>()
/** Replay-guard id per PTY, for output whose queries the daemon answers. */
const guardIds = new Map<string, string>()

/** The replay-guard id of a revealed PTY's terminal, if known. */
export function guardIdFor(ptyId: string): string | undefined {
  return guardIds.get(ptyId)
}

/** Write output the daemon answers queries for: parsed under the replay guard, so xterm doesn't reply. */
export function writeWithoutReplies(ptyId: string, term: WritableTerminal, data: string, onParsed?: () => void): void {
  const guardId = guardIds.get(ptyId)
  if (guardId) replayIntoTerminal(guardId, term, data, onParsed)
  else term.write(data, onParsed)
}

/** The PTY ended: forget its guard id. */
export function forgetReveal(ptyId: string): void {
  guardIds.delete(ptyId)
}

/** A snapshot was requested for this PTY: its live output is kept aside meanwhile. */
export function isAwaitingSnapshot(ptyId: string): boolean {
  return awaiting.has(ptyId)
}

/** Keep live output aside until the snapshot request is answered. False when none is pending. */
export function holdWhileAwaiting(ptyId: string, data: string, noReply = false): boolean {
  const held = awaiting.get(ptyId)
  if (!held) return false
  held.push({ data, noReply })
  return true
}

/**
 * Resolves true when the terminal shows the daemon's current screen. Calls for
 * a PTY already revealing share that reveal; with `again` (the terminal was
 * hidden and shown during it, so it may have missed output) one more follows.
 */
export function revealTerminal(target: RevealTarget, opts: { again?: boolean } = {}): Promise<boolean> {
  guardIds.set(target.ptyId, target.guardId)
  const running = inFlight.get(target.ptyId)
  if (running) return opts.again ? running.then(() => revealTerminal(target)) : running
  const p = doReveal(target).finally(() => {
    awaiting.delete(target.ptyId)
    inFlight.delete(target.ptyId)
  })
  inFlight.set(target.ptyId, p)
  return p
}

async function doReveal({ ptyId, guardId, term }: RevealTarget): Promise<boolean> {
  awaiting.set(ptyId, [])
  let snap: Awaited<ReturnType<typeof ipc.pty.headlessSnapshot>> = null
  try {
    snap = await ipc.pty.headlessSnapshot(ptyId)
  } catch {
    snap = null
  }
  const held = awaiting.get(ptyId) ?? []
  awaiting.delete(ptyId)
  if (!snap || snap.upToDate) {
    // Nothing replaces the screen, so the output kept aside is the screen's next part.
    for (const chunk of held) {
      if (chunk.noReply) writeWithoutReplies(ptyId, term, chunk.data)
      else term.write(chunk.data)
    }
    return snap !== null
  }
  const data = snap
  // Earlier queued writes must be parsed before reset, or they'd land after it.
  await new Promise<void>((resolve) => term.write('', resolve))
  term.reset()
  if (data.cols > 0 && data.rows > 0 && (term.cols !== data.cols || term.rows !== data.rows)) {
    try { term.resize(data.cols, data.rows) } catch { /* fit() corrects the size later */ }
  }
  await new Promise<void>((resolve) => replayIntoTerminal(guardId, term, data.data, resolve))
  // OSC 8 hyperlinks don't survive serialize(); restore them next to the text.
  const linkTerm = term as unknown as Partial<LinkTerminal>
  if (typeof linkTerm.registerMarker === 'function' && typeof linkTerm.registerLinkProvider === 'function') {
    restoreSnapshotLinks(linkTerm as LinkTerminal, data.links)
  }
  ipc.pty.snapshotApplied(ptyId, data.seq)
  return true
}
