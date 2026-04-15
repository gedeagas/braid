// ---------------------------------------------------------------------------
// Done handler — marks session complete, resolves title, drains queue
// ---------------------------------------------------------------------------

import type { HandlerContext } from './types'
import type { QueuedMessage } from '../store'
import { updateSession } from '../stateUtils'
import { persistSession } from '../persistence'
import { stopPeriodicFlush, flushStreamingBuffer } from '../streaming'
import { pendingTurnUsage } from './handleStreaming'
import { sessionWorktreePaths } from '../storage'
import { DOM_EVENT_FILES_CHANGED } from '@/lib/appBrand'
import * as ipc from '@/lib/ipc'
import { resolveEagerTitle, scheduleRefinedTitle, createTitleManagerDeps } from './titleManager'
import { maybeShowToast, fireDesktopNotification, createNotificationDeps } from './notifications'

/**
 * Handle `done` event: session turn is complete.
 *
 * Sequence:
 * 1. Drain streaming buffer + seal partial messages
 * 2. Update status (preserve 'waiting_input' if a blocking tool is active)
 * 3. Notify file tree to refresh
 * 4. Resolve eager title generation promise
 * 5. Show toast + desktop notification (after title resolves)
 * 6. Schedule refined title (fire-and-forget)
 * 7. Drain queued message (auto-send next turn)
 *
 * Queue operations are passed as parameters to avoid importing store.ts
 * directly (which would create a handleDone → store → persistence → store cycle).
 */
export async function handleDone(
  ctx: HandlerContext,
  getQueuedMessage: (sessionId: string) => QueuedMessage | null,
  drainQueue: (sessionId: string) => void,
  isEditingQueue?: (sessionId: string) => boolean
): Promise<void> {
  const { store, sessionId } = ctx

  stopPeriodicFlush(sessionId)
  flushStreamingBuffer(sessionId)
  pendingTurnUsage.delete(sessionId)

  if (!updateSession(store, sessionId, (current) => {
    const keepWaiting = current.status === 'waiting_input'
    const now = Date.now()
    const elapsed = current.runStartedAt ? now - current.runStartedAt : 0
    return {
      messages: current.messages.map((m) =>
        m.isPartial
          ? { ...m, isPartial: false, turnDurationMs: elapsed > 0 ? elapsed : m.turnDurationMs }
          : m
      ),
      status: keepWaiting ? ('waiting_input' as const) : ('idle' as const),
      activity: keepWaiting ? current.activity : null,
      runStartedAt: null,
      // Only mark the run as completed if we're actually done — a session
      // still waiting for user input hasn't finished its run yet.
      runCompletedAt: keepWaiting ? current.runCompletedAt : now,
      totalRunDurationMs: (current.totalRunDurationMs ?? 0) + elapsed
    }
  })) return

  persistSession(sessionId)

  // Notify file tree to refresh (agent likely modified files)
  const wtPath = sessionWorktreePaths.get(sessionId)
  if (wtPath) {
    // Invalidate main-process caches so the next IPC call fetches fresh data
    ipc.git.invalidateFileTree(wtPath).catch(() => {})
    ipc.git.invalidateTrackedFiles(wtPath).catch(() => {})
    window.dispatchEvent(
      new CustomEvent(DOM_EVENT_FILES_CHANGED, { detail: { worktreePath: wtPath } })
    )
  }

  // Resolve eagerly-started title (was kicked off at sendMessage time with just
  // the user message, so it's likely already settled by now — minimal blocking)
  await resolveEagerTitle(sessionId, store, createTitleManagerDeps())

  // Toast + desktop notification (after title is resolved for better message)
  const notifDeps = createNotificationDeps()
  const doneSession = store.getState().sessions[sessionId]
  if (doneSession?.status === 'idle') {
    maybeShowToast(sessionId, 'done', notifDeps)
    fireDesktopNotification(sessionId, 'done', doneSession.name, notifDeps)
  }

  // Fire-and-forget: refine title with full user + assistant context
  const refined = store.getState().sessions[sessionId]
  if (refined) {
    scheduleRefinedTitle(sessionId, refined.messages, store, createTitleManagerDeps())
  }

  // Drain queued message — auto-send the next turn (skip if user is editing)
  if (isEditingQueue?.(sessionId)) return
  const queued = getQueuedMessage(sessionId)
  if (queued && (queued.text.trim().length > 0 || (queued.images && queued.images.length > 0))) {
    drainQueue(sessionId)

    // Rebuild prompt with image tags (same format as ChatView handleSend)
    let prompt = queued.text.trim()
    if (queued.images && queued.images.length > 0) {
      const imgTags = queued.images.map((uri, i) => `[Image ${i + 1}]: ${uri}`).join('\n')
      prompt = prompt ? `${imgTags}\n\n${prompt}` : imgTags
    }
    store.getState().sendMessage(sessionId, prompt, queued.images)
  }
}
