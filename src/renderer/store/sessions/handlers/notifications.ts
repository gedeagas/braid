// ---------------------------------------------------------------------------
// Notification side effects — toast and desktop notifications
// Dependencies injected for testability (no direct store imports at call site)
// ---------------------------------------------------------------------------

import type { Toast } from '@/store/toasts'
import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '../store'
import { useProjectsStore } from '@/store/projects'
import { useToastsStore } from '@/store/toasts'
import * as ipc from '@/lib/ipc'
import type { NotificationDeps } from './types'

// ---------------------------------------------------------------------------
// Core notification logic (injectable deps — no direct store access)
// ---------------------------------------------------------------------------

/**
 * Show an in-app toast if the session is not currently visible and the user
 * has enabled this notification type.
 *
 * @param sessionId - The session that completed / errored / needs input
 * @param type - Toast type: 'done' | 'error' | 'waiting_input'
 * @param deps - Injected store accessors; pass createNotificationDeps() in production
 * @param reason - Optional reason for waiting_input ('question' | 'plan_approval')
 */
export function maybeShowToast(
  sessionId: string,
  type: Toast['type'],
  deps: NotificationDeps,
  reason?: 'question' | 'plan_approval'
): void {
  const ui = deps.getUIState()
  if (!ui.inAppNotifications) return

  if (type === 'done' && !ui.notifyOnDone) return
  if (type === 'error' && !ui.notifyOnError) return
  if (type === 'waiting_input' && !ui.notifyOnWaitingInput) return

  // Skip if user is already viewing this session
  const cv = ui.activeCenterView
  if (cv?.type === 'session' && cv.sessionId === sessionId) return

  const session = deps.getSessionInfo(sessionId)
  if (!session) return

  const info = deps.findProjectAndWorktree(session.worktreeId)
  if (!info) return

  // Only include project name when 2+ projects are open to reduce noise
  const projectName = deps.getProjectCount() >= 2 ? info.projectName : ''

  deps.addToast({
    type,
    reason,
    sessionId,
    sessionName: session.name,
    worktreeId: session.worktreeId,
    worktreeBranch: info.branch,
    projectId: info.projectId,
    projectName
  })
}

/**
 * Fire a desktop notification via the injected notifier.
 */
export function fireDesktopNotification(
  sessionId: string,
  type: 'done' | 'error' | 'waiting_input',
  sessionName: string,
  deps: Pick<NotificationDeps, 'desktopNotify'>
): void {
  deps.desktopNotify(sessionId, type, sessionName)
}

// ---------------------------------------------------------------------------
// Production factory
// ---------------------------------------------------------------------------

/**
 * Creates the real NotificationDeps wired to live Zustand stores.
 * Use this in production; pass mock objects in tests.
 */
export function createNotificationDeps(): NotificationDeps {
  return {
    getUIState: () => {
      const ui = useUIStore.getState()
      const wtId = ui.selectedWorktreeId ?? ''
      return {
        inAppNotifications: ui.inAppNotifications,
        notifyOnDone: ui.notifyOnDone,
        notifyOnError: ui.notifyOnError,
        notifyOnWaitingInput: ui.notifyOnWaitingInput,
        activeCenterView: (ui.activeCenterViewByWorktree[wtId] ?? null) as { type: string; sessionId?: string } | null
      }
    },
    getSessionInfo: (sessionId) => {
      const s = useSessionsStore.getState().sessions[sessionId]
      return s ? { name: s.name, worktreeId: s.worktreeId } : null
    },
    findProjectAndWorktree: (worktreeId) => {
      const project = useProjectsStore.getState().projects.find((p) =>
        p.worktrees.some((w) => w.id === worktreeId)
      )
      const wt = project?.worktrees.find((w) => w.id === worktreeId)
      return project && wt ? { projectId: project.id, projectName: project.name, branch: wt.branch } : null
    },
    getProjectCount: () => useProjectsStore.getState().projects.length,
    addToast: (toast) => useToastsStore.getState().addToast(toast),
    desktopNotify: (sessionId, type, name) =>
      ipc.agent.notify(sessionId, type, name)
  }
}
