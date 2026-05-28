import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestWorktreeRefresh = vi.fn()
const invalidateCache = vi.fn().mockResolvedValue(undefined)
const refreshWorktrees = vi.fn().mockResolvedValue(undefined)

vi.mock('../worktreeRefresh', () => ({
  requestWorktreeRefresh,
}))

vi.mock('@/lib/ipc', () => ({
  jira: {
    invalidateCache,
  },
}))

vi.mock('@/store/projects', () => ({
  useProjectsStore: {
    getState: () => ({
      projects: [{ id: 'proj-1', worktrees: [{ path: '/repo' }] }],
      refreshWorktrees,
    }),
  },
}))

describe('terminalCommandRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules refreshes for typed gh mutations', async () => {
    const { createTerminalCommandObserver } = await import('../terminalCommandRefresh')
    const observer = createTerminalCommandObserver('/repo', { refreshWorktrees: true })

    observer.accept('gh pr edit 1 --add-label ready\r')
    await vi.advanceTimersByTimeAsync(1_200)

    expect(requestWorktreeRefresh).toHaveBeenCalledWith('/repo', ['pr', 'checks', 'syncStatus'], {
      reason: 'pr-mutation',
      force: true,
    })
  })

  it('invalidates Jira cache for typed acli mutations', async () => {
    const { createTerminalCommandObserver } = await import('../terminalCommandRefresh')
    const observer = createTerminalCommandObserver('/repo')

    observer.accept('acli jira workitem transition USRN-123 --status Done\n')
    await vi.advanceTimersByTimeAsync(1_200)

    expect(invalidateCache).toHaveBeenCalled()
    expect(requestWorktreeRefresh).toHaveBeenCalledWith('/repo', ['jira'], {
      reason: 'jira-mutation',
      force: true,
    })
  })

  it('ignores read-only commands', async () => {
    const { createTerminalCommandObserver } = await import('../terminalCommandRefresh')
    const observer = createTerminalCommandObserver('/repo')

    observer.accept('gh pr view --json title\n')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(requestWorktreeRefresh).not.toHaveBeenCalled()
  })
})
