// Pushes the terminal colours to main, which forwards them to the PTY daemon:
// a hidden terminal's headless screen answers OSC 10/11/12 colour queries
// with them (agents pick a light or dark theme from the background), so the
// reply is the one the renderer's xterm would give.

import * as ipc from '@/lib/ipc'
import { getTerminalTheme } from '@/themes/terminal'

/** Call after a theme is applied (colours come from its CSS variables). */
export function pushTerminalColors(): void {
  try {
    const t = getTerminalTheme()
    ipc.pty.setTerminalColors({ foreground: t.foreground, background: t.background, cursor: t.cursor })
  } catch {
    // Best effort: without colours the daemon leaves colour queries unanswered.
  }
}
