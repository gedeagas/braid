import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  vi.clearAllMocks()
  clearTerminalNotificationState('bt-1')
  clearTerminalNotificationState('bt-2')
  // Restore default mock implementations
  vi.mocked(useUIStore.getState).mockReturnValue(DEFAULT_UI_STATE as ReturnType<typeof useUIStore.getState>)
  vi.mocked(useProjectsStore.getState).mockReturnValue(DEFAULT_PROJECTS_STATE as ReturnType<typeof useProjectsStore.getState>)
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('notifyTerminalStateChange', () => {
  it('fires toast and desktop notification on done', () => {
    notifyTerminalStateChange('bt-1', 'done')
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

  it('fires waiting_input for waiting state', () => {
    notifyTerminalStateChange('bt-1', 'waiting')
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'waiting_input',
      terminalId: 'bt-1',
    }))
  })

  it('fires waiting_input for blocked state', () => {
    notifyTerminalStateChange('bt-1', 'blocked')
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'waiting_input',
    }))
  })

  it('skips notification for working state', () => {
    notifyTerminalStateChange('bt-1', 'working')
    expect(mockAddToast).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('deduplicates same state', () => {
    notifyTerminalStateChange('bt-1', 'done')
    notifyTerminalStateChange('bt-1', 'done')
    expect(mockAddToast).toHaveBeenCalledOnce()
  })

  it('allows notification after state change', () => {
    notifyTerminalStateChange('bt-1', 'done')
    notifyTerminalStateChange('bt-1', 'working')  // skip (working)
    notifyTerminalStateChange('bt-1', 'done')
    expect(mockAddToast).toHaveBeenCalledTimes(2)
  })

  it('skips done toast when terminal is focused', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
      },
      activeCenterViewByWorktree: {
        'wt-1': { type: 'terminal', terminalId: 'bt-1' },
      },
      notifyOnDone: true,
      notifyOnWaitingInput: true,
      inAppNotifications: true,
    } as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'done')
    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it('still fires waiting_input when terminal is focused', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
      },
      activeCenterViewByWorktree: {
        'wt-1': { type: 'terminal', terminalId: 'bt-1' },
      },
      notifyOnDone: true,
      notifyOnWaitingInput: true,
      inAppNotifications: true,
    } as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'waiting')
    expect(mockAddToast).toHaveBeenCalledOnce()
  })

  it('skips toast when notifyOnDone is false', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
      },
      activeCenterViewByWorktree: {},
      notifyOnDone: false,
      notifyOnWaitingInput: true,
      inAppNotifications: true,
    } as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'done')
    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it('skips toast when inAppNotifications is false but still fires desktop', () => {
    vi.mocked(useUIStore.getState).mockReturnValue({
      bigTerminalsByWorktree: {
        'wt-1': [{ id: 'bt-1', label: 'Terminal 1' }],
      },
      activeCenterViewByWorktree: {},
      notifyOnDone: true,
      notifyOnWaitingInput: true,
      inAppNotifications: false,
    } as ReturnType<typeof useUIStore.getState>)

    notifyTerminalStateChange('bt-1', 'done')
    expect(mockAddToast).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('skips when terminal not found in any worktree', () => {
    notifyTerminalStateChange('bt-unknown', 'done')
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
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({
      projectName: 'my-app',
    }))
  })
})
