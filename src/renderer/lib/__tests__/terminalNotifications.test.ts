import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockAddToast = vi.fn()
const mockNotify = vi.fn()

vi.mock('@/store/ui', () => ({
  useUIStore: { getState: vi.fn() },
}))

vi.mock('@/store/projects', () => ({
  useProjectsStore: { getState: vi.fn() },
}))

vi.mock('@/store/toasts', () => ({
  useToastsStore: {
    getState: vi.fn(() => ({ addToast: mockAddToast })),
  },
}))

vi.mock('@/lib/ipc', () => ({
  agent: { notify: (...args: unknown[]) => mockNotify(...args) },
}))

// ── Import after mocks ──────────────────────────────────────────────────────

import { notifyTerminalStateChange, clearTerminalNotificationState } from '../terminalNotifications'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'

const DEFAULT_UI_STATE = {
  bigTerminalsByWorktree: {
    'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
    'wt-2': [{ id: 'bt-2', label: 'Claude Code' }],
  },
  activeCenterViewByWorktree: {},
  selectedWorktreeId: 'wt-1',
  notifyOnDone: true,
  notifyOnWaitingInput: true,
  inAppNotifications: true,
}

const DEFAULT_PROJECTS_STATE = {
  projects: [
    {
      id: 'proj-1',
      name: 'my-app',
      worktrees: [
        { id: 'wt-1', branch: 'feature/test', path: '/path/wt-1' },
        { id: 'wt-2', branch: 'main', path: '/path/wt-2' },
      ],
    },
  ],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  clearTerminalNotificationState('bt-1')
  clearTerminalNotificationState('bt-2')
  // Restore default mock implementations
  vi.mocked(useUIStore.getState).mockReturnValue(DEFAULT_UI_STATE as unknown as ReturnType<typeof useUIStore.getState>)
  vi.mocked(useProjectsStore.getState).mockReturnValue(DEFAULT_PROJECTS_STATE as ReturnType<typeof useProjectsStore.getState>)
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('notifyTerminalStateChange', () => {
  it('fires toast and desktop notification on done (after debounce)', () => {
    notifyTerminalStateChange('bt-1', 'done')
    // Not yet - debounced
    expect(mockAddToast).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'done',
      sessionId: '',
      sessionName: 'Terminal 1',
      terminalId: 'bt-1',
      terminalLabel: 'Terminal 1',
      worktreeId: 'wt-1',
      worktreeBranch: 'feature/test',
      projectId: 'proj-1',
      projectName: '',  // single project
    }))
    expect(mockNotify).toHaveBeenCalledWith(
      'bt-1', 'done', 'Terminal 1',
      undefined, undefined,
      'feature/test', 'my-app'
    )
  })

  it('fires waiting_input for waiting state (immediately)', () => {
    notifyTerminalStateChange('bt-1', 'waiting')
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'waiting_input',
      terminalId: 'bt-1',
    }))
  })

  it('fires waiting_input for blocked state (immediately)', () => {
    notifyTerminalStateChange('bt-1', 'blocked')
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'waiting_input',
    }))
  })

  it('skips notification for working state', () => {
    notifyTerminalStateChange('bt-1', 'working')
    vi.advanceTimersByTime(500)
    expect(mockAddToast).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('deduplicates same state', () => {
    notifyTerminalStateChange('bt-1', 'done')
    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledOnce()
  })

  it('deduplicates blocked after waiting (same notification type)', () => {
    notifyTerminalStateChange('bt-1', 'waiting')
    notifyTerminalStateChange('bt-1', 'blocked')
    expect(mockAddToast).toHaveBeenCalledOnce()
  })

  it('allows notification after state change', () => {
    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    notifyTerminalStateChange('bt-1', 'working')  // skip (working)
    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledTimes(2)
  })

  it('skips done toast but still fires desktop notification when terminal is focused', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
      },
      activeCenterViewByWorktree: {
        'wt-1': { type: 'terminal', terminalId: 'bt-1' },
      },
      selectedWorktreeId: 'wt-1',
      notifyOnDone: true,
      notifyOnWaitingInput: true,
      inAppNotifications: true,
    } as unknown as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).not.toHaveBeenCalled()
    // Desktop notification still fires - maybeNotify has its own window-focus check
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('fires done notification when terminal view is active but different worktree is selected', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
        'wt-2': [{ id: 'bt-2', label: 'Claude Code' }],
      },
      activeCenterViewByWorktree: {
        'wt-1': { type: 'terminal', terminalId: 'bt-1' },
      },
      selectedWorktreeId: 'wt-2',
      notifyOnDone: true,
      notifyOnWaitingInput: true,
      inAppNotifications: true,
    } as unknown as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('still fires waiting_input when terminal is focused', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
      },
      activeCenterViewByWorktree: {
        'wt-1': { type: 'terminal', terminalId: 'bt-1' },
      },
      selectedWorktreeId: 'wt-1',
      notifyOnDone: true,
      notifyOnWaitingInput: true,
      inAppNotifications: true,
    } as unknown as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'waiting')
    expect(mockAddToast).toHaveBeenCalledOnce()
  })

  it('skips toast when notifyOnDone is false', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
      },
      activeCenterViewByWorktree: {},
      selectedWorktreeId: 'wt-1',
      notifyOnDone: false,
      notifyOnWaitingInput: true,
      inAppNotifications: true,
    } as unknown as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it('skips toast when inAppNotifications is false but still fires desktop', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
      },
      activeCenterViewByWorktree: {},
      selectedWorktreeId: 'wt-1',
      notifyOnDone: true,
      notifyOnWaitingInput: true,
      inAppNotifications: false,
    } as unknown as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('skips when terminal not found in any worktree', () => {
    notifyTerminalStateChange('bt-unknown', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('includes projectName when 2+ projects exist', () => {
    vi.mocked(useProjectsStore.getState).mockReturnValue({
      projects: [
        {
          id: 'proj-1', name: 'my-app',
          worktrees: [{ id: 'wt-1', branch: 'feature/test', path: '/p1' }],
        },
        {
          id: 'proj-2', name: 'other-app',
          worktrees: [{ id: 'wt-3', branch: 'main', path: '/p2' }],
        },
      ],
    } as ReturnType<typeof useProjectsStore.getState>)

    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      projectName: 'my-app',
    }))
  })
})

describe('done debounce - waiting supersedes done', () => {
  it('suppresses done when waiting arrives within debounce window', () => {
    notifyTerminalStateChange('bt-1', 'done')
    // Waiting arrives 100ms later, within the 400ms window
    vi.advanceTimersByTime(100)
    expect(mockAddToast).not.toHaveBeenCalled()

    notifyTerminalStateChange('bt-1', 'waiting')
    // Waiting fires immediately
    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'waiting_input',
    }))

    // After full debounce window, no done notification fires
    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('suppresses done when blocked arrives within debounce window', () => {
    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(50)
    notifyTerminalStateChange('bt-1', 'blocked')

    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'waiting_input',
    }))

    vi.advanceTimersByTime(400)
    // Still only one notification
    expect(mockAddToast).toHaveBeenCalledOnce()
  })

  it('fires done when no waiting arrives within debounce window', () => {
    notifyTerminalStateChange('bt-1', 'done')
    expect(mockAddToast).not.toHaveBeenCalled()

    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'done',
    }))
  })

  it('clearTerminalNotificationState cancels pending done timer', () => {
    notifyTerminalStateChange('bt-1', 'done')
    clearTerminalNotificationState('bt-1')
    vi.advanceTimersByTime(400)

    expect(mockAddToast).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('handles rapid done-working-done-waiting sequence correctly', () => {
    // First turn: done fires normally
    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'done' }))

    // Second turn: done then waiting - only waiting fires
    notifyTerminalStateChange('bt-1', 'working')
    notifyTerminalStateChange('bt-1', 'done')
    vi.advanceTimersByTime(50)
    notifyTerminalStateChange('bt-1', 'waiting')

    expect(mockAddToast).toHaveBeenCalledTimes(2)
    expect(mockAddToast).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'waiting_input',
    }))

    vi.advanceTimersByTime(400)
    // No additional done fires
    expect(mockAddToast).toHaveBeenCalledTimes(2)
  })

  it('independent terminals do not interfere', () => {
    notifyTerminalStateChange('bt-1', 'done')
    notifyTerminalStateChange('bt-2', 'waiting')

    // bt-2 waiting fires immediately, bt-1 done is still pending
    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      terminalId: 'bt-2',
      type: 'waiting_input',
    }))

    // bt-1 done fires after debounce (not cancelled by bt-2's waiting)
    vi.advanceTimersByTime(400)
    expect(mockAddToast).toHaveBeenCalledTimes(2)
    expect(mockAddToast).toHaveBeenLastCalledWith(expect.objectContaining({
      terminalId: 'bt-1',
      type: 'done',
    }))
  })
})
