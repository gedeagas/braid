// ---------------------------------------------------------------------------
// Title generation management
// Resolves eager title promise and schedules refined title with full context
// ---------------------------------------------------------------------------

import type { Message } from '@/types'
import type { Store, TitleManagerDeps } from './types'
import { updateSession } from '../stateUtils'
import { persistSession } from '../persistence'
import { pendingTitleGenerations } from '../storage'
import * as ipc from '@/lib/ipc'

// ---------------------------------------------------------------------------
// Resolve the eagerly-started title generation
// ---------------------------------------------------------------------------

/**
 * Awaits the eagerly-started title generation promise (fired at sendMessage
 * time with just the user message). Updates the session name if the resolved
 * title differs from the current one.
 *
 * @param sessionId - The session to update
 * @param store - The sessions Zustand store
 * @param deps - Injected accessors; pass createTitleManagerDeps() in production
 */
export async function resolveEagerTitle(
  sessionId: string,
  store: Store,
  deps: TitleManagerDeps
): Promise<void> {
  const pendingTitle = deps.getPendingTitle(sessionId)
  if (!pendingTitle) return

  const sess = store.getState().sessions[sessionId]
  if (!sess || sess.customName) {
    deps.deletePendingTitle(sessionId)
    return
  }

  deps.deletePendingTitle(sessionId)

  try {
    const title = await pendingTitle
    if (!title) return

    const current = store.getState().sessions[sessionId]
    if (!current || current.customName) return
    if (title === current.name) return

    updateSession(store, sessionId, () => ({ name: title }))
    persistSession(sessionId)
    deps.syncSessionName(sessionId, title)
  } catch {
    // Notify with whatever name we have — swallow errors
  }
}

// ---------------------------------------------------------------------------
// Schedule refined title with full conversation context
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: generate a refined title using both user and assistant
 * content for better quality. Skips if session has a custom name or no
 * conversation content yet.
 *
 * @param sessionId - The session to update
 * @param messages - The full message history at time of done event
 * @param store - The sessions Zustand store
 * @param deps - Injected accessors; pass createTitleManagerDeps() in production
 */
export function scheduleRefinedTitle(
  sessionId: string,
  messages: Message[],
  store: Store,
  deps: TitleManagerDeps
): void {
  const session = store.getState().sessions[sessionId]
  if (!session || session.customName) return

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  if (!lastUser || !lastAssistant) return

  const currentTitle = session.name !== 'New Chat' ? session.name : undefined

  deps.generateRefinedTitle(
    lastUser.content.slice(0, 2000),
    lastAssistant.content.slice(0, 1000),
    currentTitle
  ).then((title) => {
    if (!title) return
    // Compare and update atomically inside setState — prevents a race where
    // another title update fires between the equality check and the setState.
    let nameChanged = false
    updateSession(store, sessionId, (fresh) => {
      if (fresh.customName || title === fresh.name) return {}
      nameChanged = true
      return { name: title }
    })
    if (nameChanged) {
      persistSession(sessionId)
      deps.syncSessionName(sessionId, title)
    }
  }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Production factory
// ---------------------------------------------------------------------------

/**
 * Creates the real TitleManagerDeps wired to live IPC.
 * Use this in production; pass mock objects in tests.
 */
export function createTitleManagerDeps(): TitleManagerDeps {
  return {
    getPendingTitle: (sessionId) => pendingTitleGenerations.get(sessionId),
    deletePendingTitle: (sessionId) => pendingTitleGenerations.delete(sessionId),
    generateRefinedTitle: (userContent, assistantContent, currentTitle) =>
      ipc.agent.generateSessionTitle(userContent, assistantContent, currentTitle),
    syncSessionName: (sessionId, name) => ipc.agent.updateSessionName(sessionId, name)
  }
}
