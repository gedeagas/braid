import { describe, it, expect, vi, beforeEach } from 'vitest'
import { maybeShowToast, fireDesktopNotification } from '../handlers/notifications'
import type { NotificationDeps, UINotificationPrefs } from '../handlers/types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEFAULT_UI: UINotificationPrefs = {
  inAppNotifications: true,
  notifyOnDone: true,
  notifyOnError: true,
  notifyOnWaitingInput: true,
  activeCenterView: null
}

function makeDeps(overrides: Partial<NotificationDeps> = {}): NotificationDeps {
  return {
    getUIState: () => ({ ...DEFAULT_UI }),
    getSessionInfo: () => ({ name: 'My Session', worktreeId: 'wt-1' }),
    findProjectAndWorktree: () => ({ projectId: 'proj-1', projectName: 'my-app', branch: 'feature/test' }),
    getProjectCount: () => 1,
    addToast: vi.fn(),
    desktopNotify: vi.fn(),
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// maybeShowToast
// ---------------------------------------------------------------------------

describe('maybeShowToast', () => {
  describe('global toggle', () => {
    it('does not call addToast when inAppNotifications is false', () => {
      const deps = makeDeps({ getUIState: () => ({ ...DEFAULT_UI, inAppNotifications: false }) })
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).not.toHaveBeenCalled()
    })

    it('calls addToast when all conditions are met', () => {
      const deps = makeDeps()
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).toHaveBeenCalledOnce()
    })
  })

  describe('per-type toggles', () => {
    it('skips done toast when notifyOnDone is false', () => {
      const deps = makeDeps({ getUIState: () => ({ ...DEFAULT_UI, notifyOnDone: false }) })
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).not.toHaveBeenCalled()
    })

    it('skips error toast when notifyOnError is false', () => {
      const deps = makeDeps({ getUIState: () => ({ ...DEFAULT_UI, notifyOnError: false }) })
      maybeShowToast('sess-1', 'error', deps)
      expect(deps.addToast).not.toHaveBeenCalled()
    })

    it('skips waiting_input toast when notifyOnWaitingInput is false', () => {
      const deps = makeDeps({ getUIState: () => ({ ...DEFAULT_UI, notifyOnWaitingInput: false }) })
      maybeShowToast('sess-1', 'waiting_input', deps)
      expect(deps.addToast).not.toHaveBeenCalled()
    })

    it('does not skip done toast when only notifyOnError is false', () => {
      const deps = makeDeps({ getUIState: () => ({ ...DEFAULT_UI, notifyOnError: false }) })
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).toHaveBeenCalledOnce()
    })
  })

  describe('active view guard', () => {
    it('skips toast when user is already viewing the session', () => {
      const deps = makeDeps({
        getUIState: () => ({
          ...DEFAULT_UI,
          activeCenterView: { type: 'session', sessionId: 'sess-1' }
        })
      })
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).not.toHaveBeenCalled()
    })

    it('shows toast when user is viewing a different session', () => {
      const deps = makeDeps({
        getUIState: () => ({
          ...DEFAULT_UI,
          activeCenterView: { type: 'session', sessionId: 'sess-other' }
        })
      })
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).toHaveBeenCalledOnce()
    })

    it('shows toast when activeCenterView is a file (not a session)', () => {
      const deps = makeDeps({
        getUIState: () => ({
          ...DEFAULT_UI,
          activeCenterView: { type: 'file' }
        })
      })
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).toHaveBeenCalledOnce()
    })

    it('shows toast when activeCenterView is null', () => {
      const deps = makeDeps()
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).toHaveBeenCalledOnce()
    })
  })

  describe('missing data guards', () => {
    it('skips toast when session info is null', () => {
      const deps = makeDeps({ getSessionInfo: () => null })
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).not.toHaveBeenCalled()
    })

    it('skips toast when project/worktree info is null', () => {
      const deps = makeDeps({ findProjectAndWorktree: () => null })
      maybeShowToast('sess-1', 'done', deps)
      expect(deps.addToast).not.toHaveBeenCalled()
    })
  })

  describe('toast payload', () => {
    it('passes correct fields to addToast (single project)', () => {
      const addToast = vi.fn()
      const deps = makeDeps({ addToast })
      maybeShowToast('sess-1', 'done', deps)
      expect(addToast).toHaveBeenCalledWith({
        type: 'done',
        reason: undefined,
        sessionId: 'sess-1',
        sessionName: 'My Session',
        worktreeId: 'wt-1',
        worktreeBranch: 'feature/test',
        projectId: 'proj-1',
        projectName: ''
      })
    })

    it('includes projectName when 2+ projects are open', () => {
      const addToast = vi.fn()
      const deps = makeDeps({ addToast, getProjectCount: () => 2 })
      maybeShowToast('sess-1', 'done', deps)
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
        projectName: 'my-app'
      }))
    })

    it('omits projectName when only 1 project is open', () => {
      const addToast = vi.fn()
      const deps = makeDeps({ addToast, getProjectCount: () => 1 })
      maybeShowToast('sess-1', 'done', deps)
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
        projectName: ''
      }))
    })

    it('passes reason for waiting_input', () => {
      const addToast = vi.fn()
      const deps = makeDeps({ addToast })
      maybeShowToast('sess-1', 'waiting_input', deps, 'question')
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ reason: 'question' }))
    })

    it('passes plan_approval reason correctly', () => {
      const addToast = vi.fn()
      const deps = makeDeps({ addToast })
      maybeShowToast('sess-1', 'waiting_input', deps, 'plan_approval')
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ reason: 'plan_approval' }))
    })
  })
})

// ---------------------------------------------------------------------------
// fireDesktopNotification
// ---------------------------------------------------------------------------

describe('fireDesktopNotification', () => {
  it('calls desktopNotify with correct args', () => {
    const desktopNotify = vi.fn()
    fireDesktopNotification('sess-1', 'done', 'My Session', { desktopNotify })
    expect(desktopNotify).toHaveBeenCalledWith('sess-1', 'done', 'My Session')
  })

  it('passes error type correctly', () => {
    const desktopNotify = vi.fn()
    fireDesktopNotification('sess-2', 'error', 'Error Session', { desktopNotify })
    expect(desktopNotify).toHaveBeenCalledWith('sess-2', 'error', 'Error Session')
  })
})
