// Connects a right-panel terminal tab to a PTY: warm reattach to its daemon
// session, or scrollback replay plus a fresh spawn.

import type { MutableRefObject } from 'react'
import * as ipc from '@/lib/ipc'
import { createTerminalCommandObserver } from '@/lib/terminalCommandRefresh'
import { replayIntoTerminal, isReplaying, POST_REPLAY_MODE_RESET } from '@/lib/replayGuard'
import { syncShown } from '@/lib/ptyOutput/visibility'
import { revealTerminal, setReplyGuard } from '@/lib/ptyOutput/reveal'
import { initPtyFeatures, isOffloadEnabled } from '@/lib/ptyFeatures'
import type { TermTab } from './terminalCache'

export async function spawnRightTab(tab: TermTab, worktreePath: string, pendingCommandRef: MutableRefObject<string | null>): Promise<void> {
  // Attempt warm reattach to daemon session first
  try {
    await initPtyFeatures()
    // A daemon that keeps screen state restores the exact screen and modes
    // from its headless terminal; an older one sends its raw ring buffer.
    const offload = isOffloadEnabled()
    const result = await ipc.pty.reattach(tab.id, offload ? { snapshot: false } : undefined)
    if (result && (offload || result.snapshot)) {
      tab.ptyId = result.sessionId
      setReplyGuard(result.sessionId, tab.id)
      syncShown(tab)
      const observer = createTerminalCommandObserver(worktreePath, { refreshWorktrees: true })
      tab.commandObserver = observer
      // Register for daemon-side scrollback persistence so this tab survives a
      // daemon death (cold app restart), matching big-terminal behavior.
      ipc.pty.registerBigTerminal(result.sessionId, tab.id)
      if (offload) {
        // The snapshot is the live program's exact screen: no banner (see bigTerminalConnect).
        await revealTerminal({ ptyId: result.sessionId, guardId: tab.id, term: tab.term })
      } else {
        // Replay under guard to suppress xterm auto-replies (DA1, DECRQM, etc.)
        // leaking back into the reconnected shell as keystrokes.
        replayIntoTerminal(tab.id, tab.term, result.snapshot)
        replayIntoTerminal(tab.id, tab.term, '\r\n\x1b[2m[session reconnected]\x1b[0m\r\n')
        replayIntoTerminal(tab.id, tab.term, POST_REPLAY_MODE_RESET)
      }
      tab.term.onData((data: string) => {
        if (isReplaying(tab.id)) return
        observer.accept(data)
        ipc.pty.write(result.sessionId, data)
      })
      requestAnimationFrame(() => {
        try { tab.fitAddon.fit(); ipc.pty.resize(result.sessionId, tab.term.cols, tab.term.rows) } catch { /* ignore */ }
      })
      return
    }
  } catch {
    // Reattach not available - fall through to scrollback restore + fresh spawn
  }

  // Fall back to scrollback file replay + fresh spawn (daemon session is gone)
  let hasScrollback = false
  try {
    const scrollback = await ipc.pty.readScrollback(tab.id)
    if (scrollback && scrollback.length > 0) {
      hasScrollback = true
      replayIntoTerminal(tab.id, tab.term, scrollback)
      replayIntoTerminal(tab.id, tab.term, '\r\n\x1b[2m[history restored]\x1b[0m\r\n')
      replayIntoTerminal(tab.id, tab.term, POST_REPLAY_MODE_RESET)
    }
  } catch {
    // ignore: best-effort replay
  }

  try {
    const id = await ipc.pty.spawn(worktreePath, { BRAID_TERMINAL_ID: tab.id })
    tab.ptyId = id
    setReplyGuard(id, tab.id)
    syncShown(tab)
    const observer = createTerminalCommandObserver(worktreePath, { refreshWorktrees: true })
    tab.commandObserver = observer
    // Register for daemon-side scrollback persistence (writes ~/Braid/bigTerminals/<id>.scrollback on exit/kill/quit).
    ipc.pty.registerBigTerminal(id, tab.id)
    tab.term.onData((data: string) => {
      // Suppress xterm auto-replies emitted during scrollback replay.
      if (isReplaying(tab.id)) return
      observer.accept(data)
      ipc.pty.write(id, data)
    })
    requestAnimationFrame(() => {
      try { tab.fitAddon.fit(); ipc.pty.resize(id, tab.term.cols, tab.term.rows) } catch { /* ignore */ }
    })
    // Auto-run a queued command only on fresh terminals (not on restored history).
    if (pendingCommandRef.current && !hasScrollback) {
      const cmd = pendingCommandRef.current
      pendingCommandRef.current = null
      setTimeout(() => {
        observer.accept(cmd + '\n')
        ipc.pty.write(id, cmd + '\n')
      }, 100)
    }
  } catch (err) {
    tab.term.write(`\x1b[31mError: ${err instanceof Error ? err.message : 'Failed to spawn terminal'}\x1b[0m\r\n`)
  }
}
