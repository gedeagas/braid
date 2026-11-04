// Turns a saved agent conversation back into a launch command when a big
// terminal is cold-restored (its shell is new after a reboot, crash or kill).
// The main process owns the saved sessions; the renderer claims one per tab.

import * as ipc from '@/lib/ipc'
import i18n from '@/lib/i18n'
import { getAgentEntry } from '@/lib/agentCatalog'
import { buildFreshLaunchCommand, buildResumeCommand, normalizeResumeSession } from '@shared/agent-resume'

export interface ColdRestoreResume {
  command: string
  /** Agent display name, for the status line. */
  label: string
  /** The saved conversation is gone: this starts the agent fresh instead. */
  fresh: boolean
}

/** Dim one-line status written into a terminal (not sent to the PTY). */
export function terminalStatusLine(key: 'terminalRestoreResuming' | 'terminalRestoreUnavailable' | 'terminalRestoreHistory' | 'terminalRestoreReconnected', agent = ''): string {
  return `\x1b[2m[${i18n.t(key, { ns: 'center', agent })}]\x1b[0m\r\n`
}

/**
 * Claim the conversation last running in this terminal and build the command
 * that relaunches it, or null when there is nothing to resume. The agent that
 * reported the session wins over the tab's agentId, so a plain terminal where
 * the user started an agent by hand is resumable too.
 */
export async function claimResumeCommand(terminalId: string, worktreePath: string): Promise<ColdRestoreResume | null> {
  let claim: Awaited<ReturnType<typeof ipc.pty.claimAgentResume>> = null
  try {
    claim = await ipc.pty.claimAgentResume(terminalId)
  } catch {
    return null
  }
  // Crosses a process boundary and is typed into a shell: validate again.
  const session = normalizeResumeSession(claim?.session)
  if (!session) return null
  const entry = getAgentEntry(session.agent)
  if (!entry) return null
  const fresh = claim?.verdict === 'missing'
  const command = fresh
    ? buildFreshLaunchCommand(session, entry.launchCmd, worktreePath)
    : buildResumeCommand(session, entry.launchCmd, worktreePath)
  return command ? { command, label: entry.label, fresh } : null
}

/**
 * Whether a cold-restored terminal should relaunch its agent. The daemon
 * samples the PTY's foreground every few seconds: if the bare shell was in
 * front when it died, the user had already quit the agent (/exit, Ctrl+D, q)
 * and gets a plain shell back. Unknown (older daemon) falls back to resuming.
 */
export function shouldResumeAfterLoss(foregroundAtLoss: 'shell' | 'command' | undefined): boolean {
  return foregroundAtLoss !== 'shell'
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
  /** Checked after the async claim: skip if the terminal went away meanwhile. */
  isAlive?: () => boolean
}

/**
 * Relaunch the saved agent conversation in a terminal whose shell was
 * re-created (cold restore). Resolves false when there is nothing to resume.
 */
export async function startAgentResume(target: AgentResumeTarget): Promise<boolean> {
  const resume = await claimResumeCommand(target.terminalId, target.worktreePath)
  if (!resume || (target.isAlive && !target.isAlive())) return false
  target.paint(blankViewportSequence(target.rows))
  target.paint(terminalStatusLine(resume.fresh ? 'terminalRestoreUnavailable' : 'terminalRestoreResuming', resume.label))
  target.run(resume.command + '\n')
  return true
}
