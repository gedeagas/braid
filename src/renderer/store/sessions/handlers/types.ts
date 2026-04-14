// ---------------------------------------------------------------------------
// Shared types for event handler modules
// ---------------------------------------------------------------------------

import type { AgentSession, Message, ToolCall } from '@/types'
import type { Toast } from '@/store/toasts'
import type { Store } from '../stateUtils'

export type { Store }

// ---------------------------------------------------------------------------
// HandlerContext — passed to every handler instead of (store, sessionId) pair
// ---------------------------------------------------------------------------

export interface HandlerContext {
  store: Store
  sessionId: string
}

// ---------------------------------------------------------------------------
// ToolResultPatch — pure data extracted from a user event, no store dependency
// ---------------------------------------------------------------------------

export interface ToolResultPatch {
  toolUseId: string
  result?: string
  error?: string
}

// ---------------------------------------------------------------------------
// NotificationDeps — injectable dependencies for notifications.ts
// Allows testing without real Zustand stores
// ---------------------------------------------------------------------------

export interface UINotificationPrefs {
  inAppNotifications: boolean
  notifyOnDone: boolean
  notifyOnError: boolean
  notifyOnWaitingInput: boolean
  activeCenterView: { type: string; sessionId?: string } | null
}

export interface SessionInfo {
  name: string
  worktreeId: string
}

export interface WorktreeInfo {
  branch: string
  projectId: string
  projectName: string
}

export interface NotificationDeps {
  getUIState: () => UINotificationPrefs
  getSessionInfo: (sessionId: string) => SessionInfo | null
  /** Finds the project and worktree info for the given worktreeId in one lookup */
  findProjectAndWorktree: (worktreeId: string) => { projectId: string; projectName: string; branch: string } | null
  /** Returns the number of projects currently loaded */
  getProjectCount: () => number
  addToast: (toast: Omit<Toast, 'id' | 'createdAt'> & {
    sessionId: string
    sessionName: string
    worktreeId: string
    worktreeBranch: string
    projectId: string
    projectName: string
    reason?: 'question' | 'plan_approval'
  }) => void
  desktopNotify: (sessionId: string, type: string, name: string) => void
}

// ---------------------------------------------------------------------------
// WorktreeSyncDeps — injectable dependencies for worktreeSync.ts
// ---------------------------------------------------------------------------

export interface WorktreeSyncDeps {
  getWorktreePath: (sessionId: string) => string | undefined
  findProjectByWorktreePath: (wtPath: string) => { id: string } | undefined
  refreshWorktrees: (projectId: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// TitleManagerDeps — injectable dependencies for titleManager.ts
// ---------------------------------------------------------------------------

export interface TitleManagerDeps {
  getPendingTitle: (sessionId: string) => Promise<string> | undefined
  deletePendingTitle: (sessionId: string) => void
  generateRefinedTitle: (
    userContent: string,
    assistantContent: string,
    currentTitle?: string
  ) => Promise<string>
  syncSessionName: (sessionId: string, name: string) => void
}

// Re-export for convenience
export type { AgentSession, Message, ToolCall, Toast }
