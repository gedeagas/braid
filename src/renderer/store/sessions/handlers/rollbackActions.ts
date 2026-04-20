// ---------------------------------------------------------------------------
// Rollback actions — rollbackToUserMessage (experimental)
//
// Rewinds a chat session to a specific user message:
//   1. Restores the worktree's files from the git snapshot taken before that turn
//   2. Truncates messages at the rollback point
//   3. Stores pendingResumeAt so the next sendMessage replays SDK history only up
//      to the preceding assistant message (SDK option `resumeSessionAt`)
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import * as ipc from '@/lib/ipc'
import { useSessionsStore } from '../store'
import { sessionWorktreePaths } from '../storage'
import { persistSession } from '../persistence'
import { updateSession } from '../stateUtils'
import type { SessionsState } from '../storeTypes'

export const createRollbackActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState, 'rollbackToUserMessage'>
> = (_set, get) => ({
  rollbackToUserMessage: async (sessionId, targetMessageId) => {
    const session = get().sessions[sessionId]
    if (!session) return

    // Safety: don't rollback mid-run. The user must stop the agent first.
    if (session.status !== 'idle' && session.status !== 'error' && session.status !== 'inactive') {
      console.warn('[Braid] rollbackToUserMessage refused: session is active')
      return
    }

    const targetIndex = session.messages.findIndex((m) => m.id === targetMessageId)
    if (targetIndex < 0) return

    const target = session.messages[targetIndex]
    if (target.role !== 'user') {
      console.warn('[Braid] rollbackToUserMessage refused: target is not a user message')
      return
    }
    if (!target.snapshotSha) {
      console.warn('[Braid] rollbackToUserMessage refused: target has no snapshot')
      return
    }

    // Find the most recent assistant message that precedes the target and has
    // an SDK uuid. That becomes the `resumeSessionAt` anchor - the SDK will
    // replay history up to (and including) that assistant message.
    // If there is none (target is the first user message), we start fresh by
    // using the empty string as a sentinel meaning "no resumeSessionAt but
    // still signal that the next send is a rollback send". Actually we encode
    // "fresh session" as undefined and drop sdkSessionId below.
    let resumeAnchorUuid: string | undefined
    for (let i = targetIndex - 1; i >= 0; i--) {
      const m = session.messages[i]
      if (m.role === 'assistant' && m.sdkUuid) {
        resumeAnchorUuid = m.sdkUuid
        break
      }
    }

    // Restore worktree files from the snapshot (best-effort but required;
    // throw propagates to caller so UI can show an error).
    const worktreePath = sessionWorktreePaths.get(sessionId) ?? ''
    if (worktreePath) {
      await ipc.git.restoreSnapshot(worktreePath, target.snapshotSha)
    }

    // Truncate messages and stash the resume anchor for the next send.
    // If there's no anchor (rollback to first user message), clear sdkSessionId
    // so communicationActions takes the "startSession" branch instead of resume.
    updateSession(useSessionsStore, sessionId, (current) => ({
      messages: current.messages.slice(0, targetIndex),
      pendingResumeAt: resumeAnchorUuid ?? undefined,
      sdkSessionId: resumeAnchorUuid ? current.sdkSessionId : undefined,
      // Clear any in-flight prompts left over from the rolled-back turn
      pendingQuestion: undefined,
      pendingPlanApproval: undefined,
      pendingToolPermission: undefined,
      pendingAuthError: undefined,
      pendingElicitation: undefined,
      activity: null,
      status: 'idle' as const
    }))
    persistSession(sessionId)
  }
})
