// ── Mobile terminal notification bridge ──────────────────────────────────────
//
// Pushes big-terminal agent status (done / needs-input) to paired mobile
// devices straight from the main process, off the agent hook status stream.
//
// This deliberately bypasses the renderer: the previous path required the
// desktop to have the terminal mounted in its bigTerminalCache (the hook
// listener drops status for unmounted terminals), so phone-driven terminals
// the desktop never opened produced no notification. Running here guarantees
// delivery whenever the daemon-level hook fires.

import { onHookStatus, type AgentHookStatus } from '../agentHookServer'
import { ptyService } from '../pty'
import { agentService } from '../agent'
import { storageService } from '../storage'
import { gitService } from '../git'

/** Last notified state per terminal, normalized, to dedup repeat events. */
const lastNotified = new Map<string, 'working' | 'waiting' | 'done'>()

function titleFor(type: 'done' | 'waiting_input'): string {
  return type === 'done' ? 'Task complete' : 'Agent needs input'
}

function bodyFor(
  type: 'done' | 'waiting_input',
  label: string,
  projectName: string | undefined,
  branch: string | undefined,
): string {
  // Lead with the project / worktree so a glance at the phone says exactly which
  // session finished; the agent label trails as context.
  const location = [projectName, branch].filter(Boolean).join(' / ')
  const who = location ? `${location} · ${label}` : label
  return type === 'done' ? `${who} finished` : `${who} needs your reply`
}

/** Resolve the project name and worktree branch for a terminal's cwd. */
async function resolveLocation(cwd: string | undefined): Promise<{ projectName?: string; branch?: string }> {
  if (!cwd) return {}
  try {
    const { projects } = storageService.load()
    for (const project of projects) {
      const worktrees = await gitService.getWorktrees(project.path).catch(() => [])
      const match = worktrees.find((worktree) => worktree.path === cwd)
      if (match) return { projectName: project.name, branch: match.branch || undefined }
    }
  } catch {
    // Best-effort enrichment only; fall through to an unlabeled notification.
  }
  return {}
}

async function handleStatus(status: AgentHookStatus): Promise<void> {
  // blocked and waiting both map to "needs input"; normalize for dedup so we
  // don't double-fire when a source reports one then the other.
  const normalized = status.state === 'blocked' ? 'waiting' : status.state
  if (normalized !== 'working' && normalized !== 'waiting' && normalized !== 'done') return
  if (lastNotified.get(status.terminalId) === normalized) return
  lastNotified.set(status.terminalId, normalized)

  const type: 'done' | 'waiting_input' | null =
    normalized === 'done' ? 'done' : normalized === 'waiting' ? 'waiting_input' : null
  if (!type) return

  const instance = ptyService.listInstances().find((item) => item.terminalId === status.terminalId)
  const label = instance?.label || instance?.title || 'Agent'
  const { projectName, branch } = await resolveLocation(instance?.cwd)

  // resolveLocation awaits git work; a newer hook event may have changed this
  // terminal's state in the meantime (e.g. waiting -> working). If so, the
  // notification we're about to send is stale - drop it so we don't push an
  // "agent needs input" alert for a terminal that's already moved on.
  if (lastNotified.get(status.terminalId) !== normalized) return

  agentService.notifyMobile({
    sessionId: status.terminalId,
    type,
    title: titleFor(type),
    body: bodyFor(type, label, projectName, branch),
    worktreePath: instance?.cwd,
    terminalId: status.terminalId,
    branch,
    projectName,
  })
}

/** Subscribe to hook status and bridge it to mobile. Returns an unsubscribe fn. */
export function startMobileTerminalNotifier(): () => void {
  return onHookStatus((status) => { void handleStatus(status) })
}
