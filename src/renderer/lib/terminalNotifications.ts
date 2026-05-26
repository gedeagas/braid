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

/**
 * Pending "done" notification timers. When a "done" state arrives, we delay
 * the notification briefly. If a "waiting" state arrives within the window,
 * we cancel the pending "done" and only fire "waiting" - this prevents the
 * double-notification (done + needs attention) when Claude finishes a turn
 * and immediately asks for input.
 */
const pendingDoneTimers = new Map<string, ReturnType<typeof setTimeout>>()
const DONE_DEBOUNCE_MS = 400

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
 *
 * "done" notifications are debounced: if "waiting" arrives within 400ms of
 * "done", the "done" notification is suppressed and only "needs attention"
 * fires. This prevents the double-notification when Claude finishes a turn
 * and immediately asks for user input.
 */
export function notifyTerminalStateChange(terminalId: string, state: AgentStatusState): void {
  // Normalize blocked -> waiting for dedup: both map to the same notification
  // type, and different detection sources can emit either for the same event.
  const normalized: AgentStatusState = state === 'blocked' ? 'waiting' : state

  // Dedup: skip if we already saw this state (across detection sources)
  if (lastNotifiedState.get(terminalId) === normalized) return
  lastNotifiedState.set(terminalId, normalized)

  // Only notify for actionable states (done, error, waiting/blocked)
  const type: 'done' | 'error' | 'waiting_input' | null =
    normalized === 'done' ? 'done'
    : normalized === 'waiting' ? 'waiting_input'
    : null
  if (!type) return

  // If a "waiting" state arrives while a "done" notification is pending,
  // cancel the "done" - the user only needs to see "needs attention".
  if (type === 'waiting_input') {
    const pendingDone = pendingDoneTimers.get(terminalId)
    if (pendingDone) {
      clearTimeout(pendingDone)
      pendingDoneTimers.delete(terminalId)
    }
    fireNotification(terminalId, type)
    return
  }

  // For "done", debounce to allow a trailing "waiting" to supersede it.
  if (type === 'done') {
    // Clear any existing pending done (shouldn't happen, but be safe)
    const existing = pendingDoneTimers.get(terminalId)
    if (existing) clearTimeout(existing)

    pendingDoneTimers.set(terminalId, setTimeout(() => {
      pendingDoneTimers.delete(terminalId)
      fireNotification(terminalId, 'done')
    }, DONE_DEBOUNCE_MS))
    return
  }

  fireNotification(terminalId, type)
}

/** Actually dispatch the toast + desktop notification. */
function fireNotification(terminalId: string, type: 'done' | 'error' | 'waiting_input'): void {
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
  const pending = pendingDoneTimers.get(terminalId)
  if (pending) {
    clearTimeout(pending)
    pendingDoneTimers.delete(terminalId)
  }
}
