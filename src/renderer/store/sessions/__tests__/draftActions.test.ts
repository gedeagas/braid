import { describe, it, expect } from 'vitest'
import type { SnippetAttachment } from '@/types'

// ---------------------------------------------------------------------------
// The draft actions are pure Zustand set() operations. We test their reducer
// logic by simulating what set() receives — a state-transform function.
// We call the slice factory with a captured-set helper and exercise each action.
// ---------------------------------------------------------------------------

import { createDraftActions } from '../handlers/draftActions'
import type { SessionsState } from '../storeTypes'

// ---------------------------------------------------------------------------
// Minimal state builder
// ---------------------------------------------------------------------------

function makeState(overrides?: Partial<SessionsState>): SessionsState {
  return {
    sessions: {},
    activeSessionId: null,
    sessionsLoaded: false,
    queuedMessages: {},
    editingQueueSessions: {},
    draftInputs: {},
    draftSnippets: {},
    draftDiffComments: {},
    streamingTextBuffers: {},
    // action stubs — not exercised here
    createSession: () => '',
    setActiveSession: () => {},
    fetchSlashCommands: async () => {},
    sendMessage: async () => {},
    stopSession: () => {},
    closeSession: () => {},
    closeSessionsByWorktree: () => {},
    updateModel: () => {},
    updateThinking: () => {},
    updateExtendedContext: () => {},
    updatePlanMode: () => {},
    renameSession: () => {},
    reorderSessions: () => {},
    loadPersistedSessions: async () => {},
    setQueuedMessage: () => {},
    setEditingQueue: () => {},
    drainDeferredQueue: () => {},
    setDraftInput: () => {},
    addDraftSnippet: () => {},
    removeDraftSnippet: () => {},
    clearDraftSnippets: () => {},
    addDiffComment: () => {},
    updateDiffComment: () => {},
    removeDiffComment: () => {},
    clearDiffComments: () => {},
    setConnectedDevice: () => {},
    linkWorktree: () => {},
    unlinkWorktree: () => {},
    answerQuestion: () => {},
    approvePlan: () => {},
    rejectPlan: () => {},
    allowTool: () => {},
    denyTool: () => {},
    alwaysAllowTool: () => {},
    retryAfterAuth: () => {},
    dismissAuthError: () => {},
    answerElicitation: () => {},
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Helper: creates slice actions wired to a mutable state object
// ---------------------------------------------------------------------------

function createActions(initial?: Partial<SessionsState>) {
  let state = makeState(initial)

  const set = (fn: ((s: SessionsState) => Partial<SessionsState>) | Partial<SessionsState>) => {
    const patch = typeof fn === 'function' ? fn(state) : fn
    state = { ...state, ...patch }
  }
  const get = () => state

  const actions = createDraftActions(set as never, get, {} as never)
  return { actions, getState: () => state }
}

function makeSnippet(id: string): SnippetAttachment {
  return { id, content: 'console.log()', firstLine: 'console.log()', lineCount: 1, charCount: 13 }
}

// ---------------------------------------------------------------------------
// setQueuedMessage
// ---------------------------------------------------------------------------

describe('setQueuedMessage', () => {
  it('sets a queued message for a session', () => {
    const { actions, getState } = createActions()
    actions.setQueuedMessage('sess-1', { text: 'hello' })
    expect(getState().queuedMessages['sess-1']).toEqual({ text: 'hello' })
  })

  it('removes the key when message is null', () => {
    const { actions, getState } = createActions({
      queuedMessages: { 'sess-1': { text: 'hi' } }
    })
    actions.setQueuedMessage('sess-1', null)
    expect('sess-1' in getState().queuedMessages).toBe(false)
  })

  it('does not affect other sessions', () => {
    const { actions, getState } = createActions({
      queuedMessages: { 'sess-2': { text: 'other' } }
    })
    actions.setQueuedMessage('sess-1', { text: 'new' })
    expect(getState().queuedMessages['sess-2']).toEqual({ text: 'other' })
  })
})

// ---------------------------------------------------------------------------
// setDraftInput
// ---------------------------------------------------------------------------

describe('setDraftInput', () => {
  it('sets the draft text', () => {
    const { actions, getState } = createActions()
    actions.setDraftInput('sess-1', 'hello world')
    expect(getState().draftInputs['sess-1']).toBe('hello world')
  })

  it('removes the key when text is empty string', () => {
    const { actions, getState } = createActions({ draftInputs: { 'sess-1': 'existing' } })
    actions.setDraftInput('sess-1', '')
    expect('sess-1' in getState().draftInputs).toBe(false)
  })

  it('does not affect other sessions', () => {
    const { actions, getState } = createActions({ draftInputs: { 'sess-2': 'other' } })
    actions.setDraftInput('sess-1', 'new')
    expect(getState().draftInputs['sess-2']).toBe('other')
  })
})

// ---------------------------------------------------------------------------
// addDraftSnippet
// ---------------------------------------------------------------------------

describe('addDraftSnippet', () => {
  it('appends a snippet to an empty list', () => {
    const { actions, getState } = createActions()
    actions.addDraftSnippet('sess-1', makeSnippet('s1'))
    expect(getState().draftSnippets['sess-1']).toEqual([makeSnippet('s1')])
  })

  it('appends to existing snippets', () => {
    const { actions, getState } = createActions({
      draftSnippets: { 'sess-1': [makeSnippet('s1')] }
    })
    actions.addDraftSnippet('sess-1', makeSnippet('s2'))
    expect(getState().draftSnippets['sess-1']).toHaveLength(2)
    expect(getState().draftSnippets['sess-1'][1].id).toBe('s2')
  })

  it('does not add when already at 5 snippets', () => {
    const initial = [1, 2, 3, 4, 5].map((n) => makeSnippet(`s${n}`))
    const { actions, getState } = createActions({
      draftSnippets: { 'sess-1': initial }
    })
    actions.addDraftSnippet('sess-1', makeSnippet('s6'))
    expect(getState().draftSnippets['sess-1']).toHaveLength(5)
  })

  it('does not affect other sessions', () => {
    const { actions, getState } = createActions({
      draftSnippets: { 'sess-2': [makeSnippet('other')] }
    })
    actions.addDraftSnippet('sess-1', makeSnippet('s1'))
    expect(getState().draftSnippets['sess-2']).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// removeDraftSnippet
// ---------------------------------------------------------------------------

describe('removeDraftSnippet', () => {
  it('removes the snippet by id', () => {
    const { actions, getState } = createActions({
      draftSnippets: { 'sess-1': [makeSnippet('s1'), makeSnippet('s2')] }
    })
    actions.removeDraftSnippet('sess-1', 's1')
    expect(getState().draftSnippets['sess-1']).toEqual([makeSnippet('s2')])
  })

  it('deletes the key when the last snippet is removed', () => {
    const { actions, getState } = createActions({
      draftSnippets: { 'sess-1': [makeSnippet('s1')] }
    })
    actions.removeDraftSnippet('sess-1', 's1')
    expect('sess-1' in getState().draftSnippets).toBe(false)
  })

  it('is a no-op when session has no snippets', () => {
    const { actions, getState } = createActions()
    expect(() => actions.removeDraftSnippet('sess-1', 'missing')).not.toThrow()
    expect('sess-1' in getState().draftSnippets).toBe(false)
  })

  it('is a no-op when the snippet id is not found', () => {
    const { actions, getState } = createActions({
      draftSnippets: { 'sess-1': [makeSnippet('s1')] }
    })
    actions.removeDraftSnippet('sess-1', 'not-found')
    expect(getState().draftSnippets['sess-1']).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// clearDraftSnippets
// ---------------------------------------------------------------------------

describe('clearDraftSnippets', () => {
  it('removes the session key entirely', () => {
    const { actions, getState } = createActions({
      draftSnippets: { 'sess-1': [makeSnippet('s1'), makeSnippet('s2')] }
    })
    actions.clearDraftSnippets('sess-1')
    expect('sess-1' in getState().draftSnippets).toBe(false)
  })

  it('is a no-op when session has no snippets', () => {
    const { actions, getState } = createActions()
    expect(() => actions.clearDraftSnippets('sess-1')).not.toThrow()
    expect('sess-1' in getState().draftSnippets).toBe(false)
  })

  it('does not affect other sessions', () => {
    const { actions, getState } = createActions({
      draftSnippets: {
        'sess-1': [makeSnippet('s1')],
        'sess-2': [makeSnippet('s2')]
      }
    })
    actions.clearDraftSnippets('sess-1')
    expect(getState().draftSnippets['sess-2']).toHaveLength(1)
  })
})
