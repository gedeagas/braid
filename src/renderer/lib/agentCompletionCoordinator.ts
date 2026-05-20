// ── Agent Completion Coordinator ──────────────────────────────────────────────
//
// Determines when a terminal agent has "completed" a task, then fires a
// callback (e.g. a toast notification, dock badge update). Uses two
// independent completion sources in parallel:
//
//   1. Hook (OSC 9999) - most reliable. done/waiting/blocked fires immediately.
//   2. Title-based    - watches working -> non-working transitions.
//
// De-duplicates completions so the same event doesn't fire twice.

import type { AgentStatusState } from './agentStatus'

type CompletionSource = 'hook' | 'title'

export interface CompletionCoordinatorConfig {
  /** Called when the agent completes a task. */
  onComplete: (source: CompletionSource, interrupted: boolean) => void
}

/**
 * Create a completion coordinator for a single terminal.
 * Call `observeHookStatus()` for OSC 9999 updates,
 * `observeTitleStatus()` for title-based updates.
 */
export function createCompletionCoordinator(config: CompletionCoordinatorConfig) {
  let currentTurn = 0
  let lastCompletedTurn = -1
  let workingStatusObserved = false
  let lastCompletionTime = 0

  // De-duplication window - same completion won't fire twice within 1s
  const COMPLETION_REPLAY_GUARD_MS = 1_000

  function dispatchCompletion(source: CompletionSource, interrupted: boolean): void {
    const now = Date.now()

    // Don't fire if we already completed this turn
    if (lastCompletedTurn >= currentTurn) return

    // Don't fire within the de-duplication window
    if (now - lastCompletionTime < COMPLETION_REPLAY_GUARD_MS) return

    // Don't fire if we never saw a "working" state this turn
    if (!workingStatusObserved) return

    lastCompletedTurn = currentTurn
    lastCompletionTime = now
    workingStatusObserved = false

    config.onComplete(source, interrupted)
  }

  return {
    /**
     * Feed OSC 9999 hook status updates.
     * "working" starts a new turn. "done"/"waiting"/"blocked" fires completion.
     */
    observeHookStatus(state: AgentStatusState, interrupted = false): void {
      if (state === 'working') {
        workingStatusObserved = true
        currentTurn++
        return
      }
      // done, waiting, blocked = completion
      if (state === 'done' || state === 'waiting' || state === 'blocked') {
        dispatchCompletion('hook', state === 'done' && interrupted)
      }
    },

    /**
     * Feed title-based status updates.
     * Only fires when transitioning from working -> non-working.
     */
    observeTitleStatus(state: AgentStatusState): void {
      if (state === 'working') {
        workingStatusObserved = true
        currentTurn++
        return
      }
      if (workingStatusObserved && (state === 'done' || state === 'waiting' || state === 'blocked')) {
        dispatchCompletion('title', false)
      }
    },

    /** Reset state (e.g. on terminal reconnect). */
    reset(): void {
      currentTurn = 0
      lastCompletedTurn = -1
      workingStatusObserved = false
      lastCompletionTime = 0
    }
  }
}

export type CompletionCoordinator = ReturnType<typeof createCompletionCoordinator>
