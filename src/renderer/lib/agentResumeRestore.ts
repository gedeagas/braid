// Ties hook-reported agent sessions to big terminal tabs, and turns a saved
// session back into a launch command when a terminal is cold-restored (its
// daemon session is gone after a reboot, crash or kill).

import { useUIStore } from '@/store/ui'
import * as ipc from '@/lib/ipc'
import { getAgentEntry } from '@/lib/agentCatalog'
import { buildResumeCommand, normalizeResumeSession } from '@shared/agent-resume'

export interface ColdRestoreResume {
  command: string
  /** Agent display name, for the "[resuming ...]" line. */
  label: string
}

/**
 * The command that relaunches the agent last running in this terminal, or
 * null when there is nothing to resume. The session's own agent wins over the
 * tab's agentId: a plain terminal where the user started an agent by hand is
 * resumable too.
 */
export function coldRestoreResumeCommand(terminalId: string, worktreePath: string): ColdRestoreResume | null {
  for (const tabs of Object.values(useUIStore.getState().bigTerminalsByWorktree)) {
    const tab = tabs.find((t) => t.id === terminalId)
    if (!tab) continue
    if (!tab.resume) return null
    const entry = getAgentEntry(tab.resume.agent)
    if (!entry) return null
    const command = buildResumeCommand(tab.resume, entry.launchCmd, worktreePath)
    return command ? { command, label: entry.label } : null
  }
  return null
}

/**
 * Escape sequence that pushes the replayed history up into scrollback and
 * homes the cursor, so a freshly launched TUI paints on a blank viewport
 * instead of overdrawing the old screen.
 */
export function blankViewportSequence(rows: number): string {
  const n = Math.max(1, Math.min(500, Math.floor(rows) || 24))
  return '\r\n'.repeat(n) + '\x1b[H'
}

export interface AgentResumeTarget {
  terminalId: string
  worktreePath: string
  rows: number
  /** Paint into the local terminal only (status lines, viewport blanking). */
  paint: (data: string) => void
  /** Type into the PTY, as if the user ran it. */
  run: (command: string) => void
}

/**
 * Relaunch the saved agent conversation in a terminal whose shell was
 * re-created (cold restore). Returns false when there is nothing to resume.
 */
export function startAgentResume(target: AgentResumeTarget): boolean {
  const resume = coldRestoreResumeCommand(target.terminalId, target.worktreePath)
  if (!resume) return false
  target.paint(blankViewportSequence(target.rows))
  target.paint(`\x1b[2m[resuming ${resume.label} session]\x1b[0m\r\n`)
  target.run(resume.command + '\n')
  return true
}

/**
 * Subscribe to session updates from agent hooks. Registered once at startup,
 * independent of whether the terminal is mounted, so sessions are recorded for
 * agents in worktrees the user hasn't opened yet. Returns an unsubscribe.
 */
export function initAgentSessionTracking(): () => void {
  return ipc.pty.onAgentHookSession((update) => {
    if (!update || typeof update.terminalId !== 'string' || !update.terminalId) return
    if (update.session === null) {
      useUIStore.getState().setBigTerminalResumeSession(update.terminalId, null)
      return
    }
    // IPC payloads cross a process boundary: validate again before storing.
    const session = normalizeResumeSession(update.session)
    if (session) useUIStore.getState().setBigTerminalResumeSession(update.terminalId, session)
  })
}
