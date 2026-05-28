import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupWorktreeRefresh,
  getWorktreeRefreshMetrics,
  requestWorktreeRefresh,
  resetWorktreeRefreshForTests,
  subscribeWorktreeRefresh,
  worktreeResourceKey,
} from '../worktreeRefresh'

async function flushRefreshes() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
    await vi.runOnlyPendingTimersAsync()
  }
  await Promise.resolve()
}

describe('worktreeRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetWorktreeRefreshForTests()
  })

  afterEach(() => {
    resetWorktreeRefreshForTests()
    vi.useRealTimers()
  })

  it('coalesces same-tick refresh requests per worktree', async () => {
    const handler = vi.fn()
    subscribeWorktreeRefresh('/repo', ['gitStatus', 'files'], handler)

    requestWorktreeRefresh('/repo', 'gitStatus', { reason: 'poll' })
    requestWorktreeRefresh('/repo', 'files', { reason: 'agent-done', force: true })

    await flushRefreshes()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      worktreePath: '/repo',
      resources: ['gitStatus', 'files'],
      resourceKeys: ['worktree:/repo:gitStatus', 'worktree:/repo:files'],
      force: true,
      reason: 'agent-done',
    }))

    expect(getWorktreeRefreshMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKey: 'worktree:/repo:gitStatus',
        observerCount: 1,
        requestCount: 1,
        dispatchCount: 1,
        completionCount: 1,
      }),
      expect.objectContaining({
        resourceKey: 'worktree:/repo:files',
        observerCount: 1,
        requestCount: 1,
        dispatchCount: 1,
        completionCount: 1,
      }),
    ]))
  })

  it('keeps manual as the highest-priority coalesced reason', async () => {
    const handler = vi.fn()
    subscribeWorktreeRefresh('/repo', 'gitStatus', handler)

    requestWorktreeRefresh('/repo', 'gitStatus', { reason: 'manual', force: true })
    requestWorktreeRefresh('/repo', 'gitStatus', { reason: 'poll' })

    await flushRefreshes()

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'manual',
      force: true,
    }))
  })

  it('keeps worktrees isolated', async () => {
    const repoA = vi.fn()
    const repoB = vi.fn()
    subscribeWorktreeRefresh('/repo-a', 'gitStatus', repoA)
    subscribeWorktreeRefresh('/repo-b', 'gitStatus', repoB)

    requestWorktreeRefresh('/repo-a', 'gitStatus')
    await flushRefreshes()

    expect(repoA).toHaveBeenCalledTimes(1)
    expect(repoB).not.toHaveBeenCalled()
  })

  it('unsubscribes handlers', async () => {
    const handler = vi.fn()
    const unsubscribe = subscribeWorktreeRefresh('/repo', 'gitStatus', handler)
    unsubscribe()

    requestWorktreeRefresh('/repo', 'gitStatus')
    await flushRefreshes()

    expect(handler).not.toHaveBeenCalled()
  })

  it('uses typed resource keys in observer events', async () => {
    const handler = vi.fn()
    subscribeWorktreeRefresh('/repo', 'pr', handler)

    expect(worktreeResourceKey('/repo', 'pr')).toBe('worktree:/repo:pr')

    requestWorktreeRefresh('/repo', 'pr', { reason: 'external' })
    await flushRefreshes()

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'pr',
      resource: 'pr',
      topics: ['pr'],
      resources: ['pr'],
      resourceKey: 'worktree:/repo:pr',
      resourceKeys: ['worktree:/repo:pr'],
    }))
  })

  it('uses stale times for polling but lets forced refreshes bypass freshness', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const handler = vi.fn()
    subscribeWorktreeRefresh('/repo', 'gitStatus', handler)

    requestWorktreeRefresh('/repo', 'gitStatus', { reason: 'external' })
    await flushRefreshes()

    vi.advanceTimersByTime(500)
    requestWorktreeRefresh('/repo', 'gitStatus', { reason: 'poll' })
    await flushRefreshes()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(getWorktreeRefreshMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKey: 'worktree:/repo:gitStatus',
        requestCount: 2,
        dispatchCount: 1,
        completionCount: 1,
        skippedFreshCount: 1,
      }),
    ]))

    requestWorktreeRefresh('/repo', 'gitStatus', { reason: 'manual', force: true })
    await flushRefreshes()

    expect(handler).toHaveBeenCalledTimes(2)
    expect(getWorktreeRefreshMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKey: 'worktree:/repo:gitStatus',
        requestCount: 3,
        dispatchCount: 2,
        completionCount: 2,
        skippedFreshCount: 1,
        lastReason: 'manual',
      }),
    ]))
  })

  it('dedupes refreshes requested while a resource is in flight', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    let resolveRefresh!: () => void
    const handler = vi.fn(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve
    }))
    subscribeWorktreeRefresh('/repo', 'checks', handler)

    requestWorktreeRefresh('/repo', 'checks', { reason: 'external' })
    await flushRefreshes()

    requestWorktreeRefresh('/repo', 'checks', { reason: 'poll' })
    await flushRefreshes()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(getWorktreeRefreshMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKey: 'worktree:/repo:checks',
        inFlight: true,
        pending: true,
        requestCount: 2,
        dispatchCount: 1,
        completionCount: 0,
        dedupedInFlightCount: 1,
      }),
    ]))

    resolveRefresh()
    await flushRefreshes()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(getWorktreeRefreshMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKey: 'worktree:/repo:checks',
        inFlight: false,
        pending: false,
        requestCount: 3,
        dispatchCount: 1,
        completionCount: 1,
        skippedFreshCount: 1,
      }),
    ]))
  })

  it('records observer errors without blocking other observers', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const brokenHandler = vi.fn(() => {
      throw new Error('boom')
    })
    const healthyHandler = vi.fn()
    subscribeWorktreeRefresh('/repo', 'checks', brokenHandler)
    subscribeWorktreeRefresh('/repo', 'checks', healthyHandler)

    requestWorktreeRefresh('/repo', 'checks')
    await flushRefreshes()

    expect(brokenHandler).toHaveBeenCalledTimes(1)
    expect(healthyHandler).toHaveBeenCalledTimes(1)
    expect(getWorktreeRefreshMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKey: 'worktree:/repo:checks',
        observerCount: 2,
        errorCount: 1,
        completionCount: 1,
      }),
    ]))

    warnSpy.mockRestore()
  })

  it('cleans up observers and metrics for removed worktrees', async () => {
    const handler = vi.fn()
    subscribeWorktreeRefresh('/repo', ['gitStatus', 'jira'], handler)

    requestWorktreeRefresh('/repo', 'gitStatus')
    await flushRefreshes()

    expect(getWorktreeRefreshMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceKey: 'worktree:/repo:gitStatus' }),
      expect.objectContaining({ resourceKey: 'worktree:/repo:jira' }),
    ]))

    cleanupWorktreeRefresh('/repo')
    requestWorktreeRefresh('/repo', ['gitStatus', 'jira'])
    await flushRefreshes()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(getWorktreeRefreshMetrics()).toEqual([
      expect.objectContaining({ resourceKey: 'worktree:/repo:gitStatus', observerCount: 0 }),
      expect.objectContaining({ resourceKey: 'worktree:/repo:jira', observerCount: 0 }),
    ])
  })
})
