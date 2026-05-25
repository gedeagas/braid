// ---------------------------------------------------------------------------
// Terminal agent notifications - toasts + desktop notifications for big terminals
// ---------------------------------------------------------------------------

import type { AgentStatusState } from '@/lib/agentStatus'
import type { CenterView } from '@/store/ui/layout'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import { useToastsStore } from '@/store/toasts'
import * as ipc from '@/lib/ipc'

/** Track last notified state per terminal to dedup across detection sources. */
const lastNotifiedState = new Map<string, AgentStatusState>()

/** Find which worktree owns a given terminalId and return context for notifications. */
function resolveTerminalContext(
  terminalId: string,
  bigTerminalsByWorktree: Record<string, { id: string; label: string }[]>
): {
  worktreeId: string
  branch: string
  projectId: string
  projectName: string
  label: string
} | null {
  for (const [worktreeId, tabs] of Object.entries(bigTerminalsByWorktree)) {
    const tab = tabs.find((t) => t.id === terminalId)
    if (!tab) continue
    const project = useProjectsStore.getState().projects.find((p) =>
      p.worktrees.some((w) => w.id === worktreeId)
    )
    const wt = project?.worktrees.find((w) => w.id === worktreeId)
    if (!project || !wt) return null
    return {
      worktreeId,
      branch: wt.branch,
      projectId: project.id,
      projectName: project.name,
      label: tab.label,
    }
  }
  return null
}

/** Check if the user is currently viewing this terminal in the center panel. */
function isTerminalFocused(
  terminalId: string,
  worktreeId: string,
  selectedWorktreeId: string | null,
  activeCenterViewByWorktree: Record<string, CenterView | null>
): boolean {
  if (selectedWorktreeId !== worktreeId) return false
  const view = activeCenterViewByWorktree[worktreeId]
  if (!view || view.type !== 'terminal') return false
  return view.terminalId === terminalId
}

/**
 * Fire a toast + desktop notification when a terminal agent changes state.
 * Called from multiple detection sources (hook, OSC, title) - dedup guard
 * ensures only one notification per state transition.
 */
export function notifyTerminalStateChange(terminalId: string, state: AgentStatusState): void {
  // Dedup: skip if we already saw this exact state (across detection sources)
  if (lastNotifiedState.get(terminalId) === state) return
  lastNotifiedState.set(terminalId, state)

  // Only notify for actionable states (done, error, waiting/blocked)
  const type: 'done' | 'error' | 'waiting_input' | null =
    state === 'done' ? 'done'
    : (state === 'waiting' || state === 'blocked') ? 'waiting_input'
    : null
  if (!type) return

  // Read UI state once and thread it through
  const ui = useUIStore.getState()
  if (type === 'done' && !ui.notifyOnDone) return
  if (type === 'waiting_input' && !ui.notifyOnWaitingInput) return

  const ctx = resolveTerminalContext(terminalId, ui.bigTerminalsByWorktree)
  if (!ctx) return

  // Focus check only suppresses the in-app toast, not the desktop notification.
  // The desktop path (maybeNotify) has its own window-focus check.
  const focused = type !== 'waiting_input' && isTerminalFocused(
    terminalId, ctx.worktreeId,
    ui.selectedWorktreeId ?? null, ui.activeCenterViewByWorktree
  )

  if (ui.inAppNotifications && !focused) {
    const projectCount = useProjectsStore.getState().projects.length
    useToastsStore.getState().addToast({
      type,
      sessionId: '',
      sessionName: ctx.label,
      worktreeId: ctx.worktreeId,
      worktreeBranch: ctx.branch,
      projectId: ctx.projectId,
      projectName: projectCount >= 2 ? ctx.projectName : '',
      terminalId,
      terminalLabel: ctx.label,
    })
  }

  // Desktop notification via existing infrastructure
  ipc.agent.notify(
    terminalId, type, ctx.label,
    undefined, undefined,
    ctx.branch, ctx.projectName
  )
}

/** Clear dedup state when a terminal is disposed. */
export function clearTerminalNotificationState(terminalId: string): void {
  lastNotifiedState.delete(terminalId)
}
