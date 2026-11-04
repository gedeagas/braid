// Connects a big terminal's xterm to a PTY: warm reattach to a live daemon
// session, cold restore (a session the daemon re-created after it died), or
// scrollback replay plus a fresh spawn. Agent conversations are resumed on the
// cold paths.

import * as ipc from '@/lib/ipc'
import { replayIntoTerminal, isReplaying, POST_REPLAY_MODE_RESET } from '@/lib/replayGuard'
import { createTerminalCommandObserver } from '@/lib/terminalCommandRefresh'
import { shouldResumeAfterLoss, startAgentResume, terminalStatusLine } from '@/lib/agentResumeRestore'
import { useUIStore } from '@/store/ui'
import { writeInitialAgentInput } from './bigTerminalInitialInput'
import type { BigTermEntry } from './bigTerminalCache'

export interface ConnectOptions {
  /** Auto-run after the first spawn only (not on restore). */
  initialCommand?: string
  initialInput?: string
}

export async function connectBigTerminal(entry: BigTermEntry, opts: ConnectOptions): Promise<void> {
  const { terminalId, worktreePath, term } = entry
  const { initialCommand, initialInput } = opts
  let hasScrollback = false

  // Attempt warm reattach to daemon session first
  let reattached = false
  try {
    const result = await ipc.pty.reattach(terminalId)
    if (result && result.snapshot) {
      reattached = true
      hasScrollback = true
      entry.ptyId = result.sessionId
      const commandObserver = createTerminalCommandObserver(worktreePath, { refreshWorktrees: true })
      entry.commandObserver = commandObserver
      // A cold-restored session is a fresh shell the new daemon re-created
      // from a checkpoint after the old one died. Claim it (one-shot, so a
      // second window or the phone can't also relaunch) before resuming.
      const claimed = result.coldRestored === true && await ipc.pty.consumeColdRestore(terminalId)
      replayIntoTerminal(terminalId, term, result.snapshot)
      replayIntoTerminal(terminalId, term, '\r\n' + terminalStatusLine(claimed ? 'terminalRestoreHistory' : 'terminalRestoreReconnected'))
      replayIntoTerminal(terminalId, term, POST_REPLAY_MODE_RESET)
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
      commandObserver.accept(initialCommand + '\n')
      ipc.pty.write(ptyId, initialCommand + '\n')
      if (initialInput) void writeInitialAgentInput(entry, ptyId, initialInput)
    } else if (!initialCommand) {
      // The daemon session is gone and its checkpoint too (daemon wiped or
      // unavailable). Relaunch the agent conversation that was running here
      // instead of leaving a dead shell under the replayed history.
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
