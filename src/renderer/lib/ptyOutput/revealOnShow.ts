// When a terminal is shown again and the daemon offloads hidden terminals,
// restore its screen from a snapshot (it got no output while hidden). Covers
// right-panel tabs (guard id = tab id) and big terminals (= terminal id).
// The first connect of a terminal reveals on its own (see spawnRightTab and
// bigTerminalConnect), before the PTY id is known here.

import * as ipc from '@/lib/ipc'
import { isOffloadEnabled } from '@/lib/ptyFeatures'
import { onShowChange, type ShowTarget } from './visibility'
import { revealTerminal, type RevealTerminal } from './reveal'

interface Revealable extends ShowTarget {
  term?: RevealTerminal
  fitAddon?: { fit(): void }
  id?: string
  terminalId?: string
}

let bound = false

export function bindRevealOnShow(): void {
  if (bound) return
  bound = true
  onShowChange((target: Revealable, shown) => {
    if (!shown || !isOffloadEnabled() || !target.ptyId || !target.term) return
    const guardId = target.terminalId ?? target.id
    if (!guardId) return
    const { ptyId, term } = target
    const before = `${term.cols}x${term.rows}`
    // A show while a reveal runs means it was hidden meanwhile: reveal again after.
    void revealTerminal({ ptyId, guardId, term }, { again: true }).then(() => {
      // The snapshot is at the PTY's size; the pane may have changed meanwhile.
      if (`${term.cols}x${term.rows}` === before || !target.fitAddon) return
      try {
        target.fitAddon.fit()
        ipc.pty.resize(ptyId, term.cols, term.rows)
      } catch { /* not attached yet */ }
    })
  })
}
