// ---------------------------------------------------------------------------
// Draft and attachment actions — setQueuedMessage, setDraftInput,
// addDraftSnippet, removeDraftSnippet, clearDraftSnippets
// ---------------------------------------------------------------------------

import type { StateCreator } from 'zustand'
import type { DiffComment } from '@/types'
import type { SessionsState } from '../storeTypes'

export const createDraftActions: StateCreator<
  SessionsState,
  [],
  [],
  Pick<SessionsState,
    | 'setQueuedMessage'
    | 'setEditingQueue'
    | 'drainDeferredQueue'
    | 'setDraftInput'
    | 'addDraftSnippet'
    | 'removeDraftSnippet'
    | 'clearDraftSnippets'
    | 'addDiffComment'
    | 'updateDiffComment'
    | 'removeDiffComment'
    | 'clearDiffComments'
  >
> = (set, get) => ({
  setQueuedMessage: (sessionId, message) => {
    set((s) => {
      const next = { ...s.queuedMessages }
      if (message === null) {
        delete next[sessionId]
      } else {
        next[sessionId] = message
      }
      return { queuedMessages: next }
    })
  },

  setEditingQueue: (sessionId, editing) => {
    set((s) => {
      const next = { ...s.editingQueueSessions }
      if (editing) {
        next[sessionId] = true
      } else {
        delete next[sessionId]
      }
      return { editingQueueSessions: next }
    })
  },

  drainDeferredQueue: (sessionId) => {
    const { sessions, queuedMessages, sendMessage } = get()
    const session = sessions[sessionId]
    const queued = queuedMessages[sessionId]
    if (!session || session.status !== 'idle' || !queued) return
    if (!queued.text.trim() && !(queued.images && queued.images.length > 0)) return
    // Clear the queue first, then send.
    // Note: queued.text already contains [Image N] tags from handleSend,
    // so we do NOT re-embed them here to avoid duplicate image references.
    set((s) => {
      const next = { ...s.queuedMessages }
      delete next[sessionId]
      return { queuedMessages: next }
    })
    const prompt = queued.text.trim()
    sendMessage(sessionId, prompt, queued.images)
  },

  setDraftInput: (sessionId, text) => {
    set((s) => {
      const next = { ...s.draftInputs }
      if (text === '') {
        delete next[sessionId]
      } else {
        next[sessionId] = text
      }
      return { draftInputs: next }
    })
  },

  addDraftSnippet: (sessionId, snippet) => {
    set((s) => {
      const existing = s.draftSnippets[sessionId] ?? []
      if (existing.length >= 5) return s // cap at 5 snippets
      return { draftSnippets: { ...s.draftSnippets, [sessionId]: [...existing, snippet] } }
    })
  },

  removeDraftSnippet: (sessionId, snippetId) => {
    set((s) => {
      const existing = s.draftSnippets[sessionId]
      if (!existing) return s
      const filtered = existing.filter((sn) => sn.id !== snippetId)
      const next = { ...s.draftSnippets }
      if (filtered.length === 0) {
        delete next[sessionId]
      } else {
        next[sessionId] = filtered
      }
      return { draftSnippets: next }
    })
  },

  clearDraftSnippets: (sessionId) => {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.draftSnippets
      return { draftSnippets: rest }
    })
  },

  addDiffComment: (sessionId, comment) => {
    set((s) => {
      const existing = s.draftDiffComments[sessionId] ?? []
      return { draftDiffComments: { ...s.draftDiffComments, [sessionId]: [...existing, comment] } }
    })
  },

  updateDiffComment: (sessionId, commentId, text) => {
    set((s) => {
      const existing = s.draftDiffComments[sessionId]
      if (!existing) return s
      const updated = existing.map((c) => c.id === commentId ? { ...c, text } : c)
      return { draftDiffComments: { ...s.draftDiffComments, [sessionId]: updated } }
    })
  },

  removeDiffComment: (sessionId, commentId) => {
    set((s) => {
      const existing = s.draftDiffComments[sessionId]
      if (!existing) return s
      const filtered = existing.filter((c) => c.id !== commentId)
      const next = { ...s.draftDiffComments }
      if (filtered.length === 0) {
        delete next[sessionId]
      } else {
        next[sessionId] = filtered
      }
      return { draftDiffComments: next }
    })
  },

  clearDiffComments: (sessionId) => {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.draftDiffComments
      return { draftDiffComments: rest }
    })
  },
})
