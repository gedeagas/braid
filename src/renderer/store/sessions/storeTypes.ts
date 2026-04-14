// ---------------------------------------------------------------------------
// Store type definitions — shared between store.ts and action slice factories
// ---------------------------------------------------------------------------

import type { AgentSession, DiffComment, LinkedWorktree, ModelId, SnippetAttachment } from '@/types'

export interface QueuedMessage {
  text: string
  images?: string[]
}

export interface SessionsState {
  sessions: Record<string, AgentSession>
  activeSessionId: string | null
  /** Whether persisted sessions have been loaded from disk */
  sessionsLoaded: boolean
  /** Queued message per session (set while the session is running) */
  queuedMessages: Record<string, QueuedMessage>
  /** Draft input text per session (preserved across tab switches) */
  draftInputs: Record<string, string>
  /** Pasted snippet attachments per session (preserved across tab switches) */
  draftSnippets: Record<string, SnippetAttachment[]>
  /** Diff review comments per session (ephemeral, cleared after sending) */
  draftDiffComments: Record<string, DiffComment[]>
  /** Sessions whose queued message is currently being edited by the user */
  editingQueueSessions: Record<string, true>
  /** Buffered streaming text not yet flushed to the visible message */
  streamingTextBuffers: Record<string, string>

  createSession: (worktreeId: string, worktreePath: string) => string
  setActiveSession: (sessionId: string | null) => void
  fetchSlashCommands: (sessionId: string) => Promise<void>
  sendMessage: (sessionId: string, text: string, images?: string[], options?: { tag?: string }) => Promise<void>
  stopSession: (sessionId: string) => void
  closeSession: (sessionId: string) => void
  /** Cascade-close every session belonging to a worktree (memory + disk) */
  closeSessionsByWorktree: (worktreeId: string) => void
  updateModel: (sessionId: string, model: ModelId) => void
  updateThinking: (sessionId: string, enabled: boolean) => void
  updatePlanMode: (sessionId: string, enabled: boolean) => void
  renameSession: (sessionId: string, name: string) => void
  reorderSessions: (worktreeId: string, fromIndex: number, toIndex: number) => void
  loadPersistedSessions: () => Promise<void>
  setQueuedMessage: (sessionId: string, message: QueuedMessage | null) => void
  /** Mark a session's queued message as being edited (prevents auto-send on done) */
  setEditingQueue: (sessionId: string, editing: boolean) => void
  /** Drain and send the queued message if the session is idle (used after editing finishes) */
  drainDeferredQueue: (sessionId: string) => void
  setDraftInput: (sessionId: string, text: string) => void
  addDraftSnippet: (sessionId: string, snippet: SnippetAttachment) => void
  removeDraftSnippet: (sessionId: string, snippetId: string) => void
  clearDraftSnippets: (sessionId: string) => void
  addDiffComment: (sessionId: string, comment: DiffComment) => void
  updateDiffComment: (sessionId: string, commentId: string, text: string) => void
  removeDiffComment: (sessionId: string, commentId: string) => void
  clearDiffComments: (sessionId: string) => void
  setConnectedDevice: (sessionId: string, deviceId: string | undefined) => void
  linkWorktree: (sessionId: string, linked: LinkedWorktree) => void
  unlinkWorktree: (sessionId: string, worktreeId: string) => void
  answerQuestion: (sessionId: string, answers: Record<string, string>) => void
  approvePlan: (sessionId: string) => void
  rejectPlan: (sessionId: string, reason?: string) => void
  allowTool: (sessionId: string) => void
  denyTool: (sessionId: string) => void
  /** Allow this tool and persist `rule` (e.g. "Bash(git:*)") to the global allow list. */
  alwaysAllowTool: (sessionId: string, rule: string) => void
  /** Retry the last user message after re-authentication. */
  retryAfterAuth: (sessionId: string) => void
  /** Dismiss the auth error prompt without retrying. */
  dismissAuthError: (sessionId: string) => void
  /** Respond to an MCP elicitation (OAuth auth or form input). */
  answerElicitation: (sessionId: string, result: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) => void
}
