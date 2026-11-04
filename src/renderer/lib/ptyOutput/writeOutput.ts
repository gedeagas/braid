// The one place PTY output is written into an xterm.
//
// Main limits how much output is in flight to the renderer (flow control,
// Stage A). For that it needs to know how much xterm has actually parsed:
// after each write's parse callback we add to a per-terminal running total and
// send it as `pty:ackData`, at most every 5,000 characters or 16ms. Main only
// accepts a total higher than the last one, so this needs no ordering care.
//
// Writes that did not come from `pty:data` (replayed snapshots, status lines)
// pass no ptyId: main never counted them, so they must not be acked.

import * as ipc from '@/lib/ipc'

export const ACK_EVERY_CHARS = 5_000
export const ACK_EVERY_MS = 16

/** What this module needs from an xterm Terminal. */
export interface WritableTerminal {
  write(data: string, callback?: () => void): void
}

interface AckState {
  processed: number
  acked: number
  timer: ReturnType<typeof setTimeout> | null
}

const acks = new Map<string, AckState>()

function sendAck(ptyId: string, state: AckState): void {
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  if (state.processed === state.acked) return
  state.acked = state.processed
  ipc.pty.ackData(ptyId, state.processed)
}

/** Count `chars` of pty:data output for `ptyId` as processed. */
export function markProcessed(ptyId: string, chars: number): void {
  if (chars <= 0) return
  let state = acks.get(ptyId)
  if (!state) {
    state = { processed: 0, acked: 0, timer: null }
    acks.set(ptyId, state)
  }
  state.processed += chars
  if (state.processed - state.acked >= ACK_EVERY_CHARS) {
    sendAck(ptyId, state)
  } else if (!state.timer) {
    const s = state
    s.timer = setTimeout(() => sendAck(ptyId, s), ACK_EVERY_MS)
  }
}

/** Forget a terminal that went away (its counts die with it). */
export function forgetAcks(ptyId: string): void {
  const state = acks.get(ptyId)
  if (state?.timer) clearTimeout(state.timer)
  acks.delete(ptyId)
}

export interface WriteOptions {
  /** Set for output that arrived as pty:data, so it is acknowledged to main. */
  ptyId?: string
  /** Called once xterm has parsed this write. */
  onParsed?: () => void
}

export function writeToTerminal(term: WritableTerminal, data: string, opts: WriteOptions = {}): void {
  const { ptyId, onParsed } = opts
  if (!ptyId && !onParsed) {
    term.write(data)
    return
  }
  term.write(data, () => {
    if (ptyId) markProcessed(ptyId, data.length)
    onParsed?.()
  })
}

export function resetAckTrackerForTests(): void {
  for (const state of acks.values()) if (state.timer) clearTimeout(state.timer)
  acks.clear()
}
