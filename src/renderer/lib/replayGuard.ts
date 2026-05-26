// ── Replay Guard ──────────────────────────────────────────────────────────────
//
// Counter-based guard that suppresses xterm auto-replies (DA1, DECRQM, OSC
// queries) during scrollback replay. Without this, xterm responds to query
// sequences embedded in the scrollback data, sending garbage to the shell's
// stdin (e.g. `^[[?64;1;2;6;...c` from DA1).
//
// Uses xterm's write-completion callback for precise timing - only replies
// generated while parsing replayed bytes are suppressed. Real user keystrokes
// typed after replay completes are never affected.
//
// Simplified for Braid's single-pane-per-terminal model (no splits).

import type { Terminal } from '@xterm/xterm'

// Map<terminalId, counter> - counter > 0 means replaying
const replayingTerminals = new Map<string, number>()

/** Check whether a terminal is currently replaying scrollback. */
export function isReplaying(terminalId: string): boolean {
  return (replayingTerminals.get(terminalId) ?? 0) > 0
}

/**
 * Write data to a terminal under replay guard.
 *
 * While this write is being parsed by xterm, any auto-replies (from DA1,
 * DECRQM, etc. embedded in the scrollback) should be suppressed by checking
 * `isReplaying()` in the `term.onData` handler.
 *
 * The guard is lifted when xterm's write-completion callback fires,
 * meaning all bytes have been parsed and rendered.
 */
export function replayIntoTerminal(terminalId: string, term: Terminal, data: string): void {
  if (!data) return
  replayingTerminals.set(terminalId, (replayingTerminals.get(terminalId) ?? 0) + 1)
  term.write(data, () => {
    const remaining = (replayingTerminals.get(terminalId) ?? 1) - 1
    if (remaining <= 0) {
      replayingTerminals.delete(terminalId)
    } else {
      replayingTerminals.set(terminalId, remaining)
    }
  })
}

/**
 * ANSI escape sequences to clear stale terminal modes after scrollback replay.
 *
 * When restoring scrollback that was captured mid-TUI (e.g. vim, less, htop),
 * the serialized buffer may contain mode-setting sequences that leave the
 * terminal in an unexpected state. This reset sequence clears them all.
 *
 * | Sequence        | Mode                         | Why                                    |
 * |-----------------|------------------------------|----------------------------------------|
 * | \x1b[?25h       | DECTCEM: show cursor         | Cursor may be hidden by TUI            |
 * | \x1b[?1000l     | Mouse button events OFF      | Prevents phantom mouse events          |
 * | \x1b[?1002l     | Mouse button+motion OFF      | Prevents phantom mouse events          |
 * | \x1b[?1003l     | All mouse motion OFF         | Prevents phantom mouse events          |
 * | \x1b[?1004l     | Focus event reporting OFF    | Prevents BEL on pane click             |
 * | \x1b[?1006l     | SGR mouse encoding OFF       | Prevents phantom mouse events          |
 * | \x1b[?2004l     | Bracketed paste OFF          | Prevents stale paste markers           |
 */
export const POST_REPLAY_MODE_RESET =
  '\x1b[?25h' +
  '\x1b[?1000l' +
  '\x1b[?1002l' +
  '\x1b[?1003l' +
  '\x1b[?1004l' +
  '\x1b[?1006l' +
  '\x1b[?2004l'
