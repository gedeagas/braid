// Connects a big terminal's xterm to a PTY: warm reattach to a live daemon
// session, cold restore (a session the daemon re-created after it died), or
// scrollback replay plus a fresh spawn. Agent conversations are resumed on the
// cold paths.

import * as ipc from '@/lib/ipc'
import { replayIntoTerminal, isReplaying, POST_REPLAY_MODE_RESET } from '@/lib/replayGuard'
import { createTerminalCommandObserver } from '@/lib/terminalCommandRefresh'
import { shouldResumeAfterLoss, startAgentResume, terminalStatusLine } from '@/lib/agentResumeRestore'
import { useUIStore } from '@/store/ui'
import { typeInitialCommand } from './bigTerminalInitialInput'
import { syncShown } from '@/lib/ptyOutput/visibility'
import { revealTerminal, setReplyGuard } from '@/lib/ptyOutput/reveal'
import { initPtyFeatures, isOffloadEnabled } from '@/lib/ptyFeatures'
import type { BigTermEntry } from './bigTerminalCache'

export interface ConnectOptions {
  /** Auto-run after the first spawn only (not on restore). */
  initialCommand?: string
  initialInput?: string
  /**
   * Background warm-up: when the live session can't be reattached, stop
   * instead of spawning a shell and resuming its agent unseen. Called with no
   * terminal spawned; returns true when the caller dropped the entry.
   */
  onReattachFailed?: () => boolean
}

export async function connectBigTerminal(entry: BigTermEntry, opts: ConnectOptions): Promise<void> {
  const { terminalId, worktreePath, term } = entry
  const { initialCommand, initialInput } = opts
  let hasScrollback = false

  // Attempt warm reattach to daemon session first
  let reattached = false
  try {
    await initPtyFeatures()
    // A daemon that keeps screen state restores the exact screen and modes
    // from its headless terminal; an older one sends its raw ring buffer.
    const offload = isOffloadEnabled()
    const result = await ipc.pty.reattach(terminalId, offload ? { snapshot: false } : undefined)
    if (result && (offload || result.snapshot)) {
      reattached = true
      hasScrollback = true
      entry.ptyId = result.sessionId
      setReplyGuard(result.sessionId, terminalId)
      syncShown(entry)
      const commandObserver = createTerminalCommandObserver(worktreePath, { refreshWorktrees: true })
      entry.commandObserver = commandObserver
      // A cold-restored session is a fresh shell the new daemon re-created
      // from a checkpoint after the old one died. Claim it (one-shot, so a
      // second window or the phone can't also relaunch) before resuming.
      const claimed = result.coldRestored === true && await ipc.pty.consumeColdRestore(terminalId)
      if (offload) {
        // The snapshot is the live program's exact screen: no banner, which
        // would move its cursor or land inside an unfinished escape sequence.
        await revealTerminal({ ptyId: result.sessionId, guardId: terminalId, term })
      } else {
        replayIntoTerminal(terminalId, term, result.snapshot)
        replayIntoTerminal(terminalId, term, '\r\n' + terminalStatusLine(claimed ? 'terminalRestoreHistory' : 'terminalRestoreReconnected'))
        replayIntoTerminal(terminalId, term, POST_REPLAY_MODE_RESET)
      }
      ipc.pty.registerBigTerminal(result.sessionId, terminalId)
      if (claimed && !shouldResumeAfterLoss(result.foregroundAtLoss)) {
        ipc.pty.forgetAgentResume(terminalId)
        useUIStore.getState().clearRestoredBigTerminalStatus(terminalId)
      } else if (claimed && !entry.disposed) {
        const ptyId = result.sessionId
        void startAgentResume({
          terminalId, worktreePath, rows: term.rows,
          paint: (d) => replayIntoTerminal(terminalId, term, d),
          run: (c) => { commandObserver.accept(c); ipc.pty.write(ptyId, c) },
          isAlive: () => !entry.disposed && entry.ptyId === ptyId,
        }).then((started) => { if (!started) useUIStore.getState().clearRestoredBigTerminalStatus(terminalId) })
      }
      term.onData((d) => {
        if (isReplaying(terminalId)) return
        // Phone owns input: don't forward to the PTY; typing is a take-back.
        if (entry.mobileInputLocked) { entry.onDesktopInputWhileLocked?.(); return }
        commandObserver.accept(d)
        if (entry.ptyId && !entry.disposed) ipc.pty.write(entry.ptyId, d)
      })
    }
  } catch {
    // Reattach not available or failed - fall through to normal spawn
  }

  if (reattached || entry.disposed) return
  if (opts.onReattachFailed?.()) return

  // Fall back to scrollback file replay + fresh spawn
  try {
    const scrollback = await ipc.pty.readScrollback(terminalId)
    if (scrollback && scrollback.length > 0) {
      hasScrollback = true
      // Replay under guard to suppress xterm auto-replies (DA1, DECRQM, etc.)
      replayIntoTerminal(terminalId, term, scrollback)
      replayIntoTerminal(terminalId, term, '\r\n' + terminalStatusLine('terminalRestoreHistory'))
      // Clear stale terminal modes (cursor, mouse, focus, bracketed paste)
      replayIntoTerminal(terminalId, term, POST_REPLAY_MODE_RESET)
    }
  } catch {
    // ignore: best-effort replay
  }

  // Bail out if disposed while scrollback was loading
  if (entry.disposed) return

  try {
    // Pass BRAID_TERMINAL_ID so the hook script can identify this terminal
    // when POSTing to the loopback HTTP server.
    const ptyId = await ipc.pty.spawn(worktreePath, { BRAID_TERMINAL_ID: terminalId })
    // If disposed while spawn was in flight, kill the orphaned PTY immediately
    if (entry.disposed) {
      try { ipc.pty.kill(ptyId) } catch {}
      return
    }
    entry.ptyId = ptyId
    setReplyGuard(ptyId, terminalId)
    syncShown(entry)
    const commandObserver = createTerminalCommandObserver(worktreePath, { refreshWorktrees: true })
    entry.commandObserver = commandObserver
    ipc.pty.registerBigTerminal(ptyId, terminalId)
    term.onData((d) => {
      // Suppress xterm auto-replies during scrollback replay
      if (isReplaying(terminalId)) return
      // Phone owns input: don't forward to the PTY; typing is a take-back.
      if (entry.mobileInputLocked) { entry.onDesktopInputWhileLocked?.(); return }
      commandObserver.accept(d)
      if (entry.ptyId && !entry.disposed) ipc.pty.write(entry.ptyId, d)
    })
    // Auto-run initialCommand only on fresh terminals (no restored scrollback)
    if (initialCommand && !hasScrollback) {
      void typeInitialCommand(entry, ptyId, initialCommand, initialInput, (c) => commandObserver.accept(c))
    } else {
      // The daemon session is gone and its checkpoint too (hibernated, daemon
      // wiped or unavailable). Relaunch the agent conversation that was
      // running here instead of leaving a dead shell under the replayed
      // history. A shell the user exited has no saved session (main forgets
      // it on a self exit), so nothing is relaunched there.
      void startAgentResume({
        terminalId, worktreePath, rows: term.rows,
        paint: (d) => replayIntoTerminal(terminalId, term, d),
        run: (c) => { commandObserver.accept(c); ipc.pty.write(ptyId, c) },
        isAlive: () => !entry.disposed && entry.ptyId === ptyId,
      }).then((started) => { if (!started) useUIStore.getState().clearRestoredBigTerminalStatus(terminalId) })
    }
  } catch (err) {
    if (!entry.disposed) {
      term.write(`\r\n\x1b[31m[failed to spawn pty]\x1b[0m\r\n`)
    }
  }
}
