import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestWorktreeRefresh, resetWorktreeRefreshForTests } from '@/lib/worktreeRefresh'
import type { PrStatus } from '@/store/prCache'
import { ChecksView } from '../ChecksView'

const prCacheState: {
  cache: Record<string, { data: PrStatus | null; fetchedAt: number; loading: boolean }>
} = {
  cache: {
    '/repo': { data: null, fetchedAt: 123, loading: false },
  },
}

const projectsStoreState = {
  projects: [
    {
      id: 'project-1',
      name: 'repo',
      path: '/repo',
      createdAt: 1,
      worktrees: [
        {
          id: 'wt-1',
          projectId: 'project-1',
          branch: 'feature/pr-link',
          path: '/repo',
          isMain: false,
          sessions: [],
        },
      ],
    },
  ],
}

const uiStoreState = {
  jiraBaseUrl: '',
  openFile: vi.fn(),
  setActiveCenterView: vi.fn(),
  openCodeReview: vi.fn(),
  openTaskPr: vi.fn(),
  prPrompt: '',
}

const basePr: PrStatus = {
  number: 42,
  title: 'Fix PR link routing',
  state: 'OPEN',
  url: 'https://github.com/example/repo/pull/42',
  headBranch: 'feature/pr-link',
  baseRefName: 'main',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: 'APPROVED',
  mergeStateStatus: 'CLEAN',
}

vi.mock('@/lib/ipc', () => ({
  cleanIpcError: vi.fn((_err: unknown, fallback: string) => fallback),
  github: {
    getPrStatus: vi.fn().mockResolvedValue(null),
    getChecks: vi.fn().mockResolvedValue([]),
    getDeployments: vi.fn().mockResolvedValue([]),
    getGitSyncStatus: vi.fn().mockResolvedValue(null),
    getReviews: vi.fn().mockResolvedValue(null),
  },
  jira: {
    getIssuesForBranch: vi.fn().mockResolvedValue(null),
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock('@/store/prCache', () => {
  const usePrCacheStore = vi.fn((selector: (state: typeof prCacheState) => unknown) => selector(prCacheState))
  Object.assign(usePrCacheStore, {
    getState: () => prCacheState,
    setState: (updater: Partial<typeof prCacheState> | ((state: typeof prCacheState) => Partial<typeof prCacheState>)) => {
      const next = typeof updater === 'function' ? updater(prCacheState) : updater
      Object.assign(prCacheState, next)
    },
  })
  return { usePrCacheStore }
})

vi.mock('@/store/projects', () => ({
  useProjectsStore: vi.fn((selector: (state: typeof projectsStoreState) => unknown) => selector(projectsStoreState)),
}))

vi.mock('@/store/sessions', () => {
  const sessionsState = {
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    setActiveSession: vi.fn(),
  }
  return { useSessionsStore: vi.fn((selector: (state: typeof sessionsState) => unknown) => selector(sessionsState)) }
})

vi.mock('@/store/ui', () => {
  return {
    useUIStore: vi.fn((selector: (state: typeof uiStoreState) => unknown) => selector(uiStoreState)),
  }
})

vi.mock('@/store/flash', () => ({ flash: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../ChecksSections', () => ({
  getCheckConclusion: vi.fn(() => 'success'),
  GitStatusSection: () => null,
  DeploymentsSection: () => null,
  ChecksSection: () => null,
  ChecksViewSkeleton: () => <div>loading checks</div>,
  ChecksNoPr: () => <div>No open pull request</div>,
}))
vi.mock('../JiraSection', () => ({ JiraSection: () => null }))
vi.mock('../ReviewsSection', () => ({ ReviewsSection: () => null }))
vi.mock('../PushErrorPanel', () => ({ PushErrorPanel: () => null }))

describe('ChecksView', () => {
  let ipc: typeof import('@/lib/ipc')

  beforeEach(async () => {
    vi.clearAllMocks()
    resetWorktreeRefreshForTests()
    prCacheState.cache['/repo'] = { data: null, fetchedAt: 123, loading: false }
    ipc = await import('@/lib/ipc')
  })

  it('force-refreshes PR status when the tab becomes active', async () => {
    const { rerender } = render(<ChecksView worktreePath="/repo" worktreeId="wt-1" isActive={false} />)

    expect(ipc.github.getPrStatus).not.toHaveBeenCalled()

    rerender(<ChecksView worktreePath="/repo" worktreeId="wt-1" isActive={true} />)

    await waitFor(() => {
      expect(ipc.github.getPrStatus).toHaveBeenCalledWith('/repo', true)
      expect(ipc.jira.getIssuesForBranch).toHaveBeenCalledWith('/repo', undefined, true)
    })
  })

  it('does not force-refresh Jira for PR-only refresh events', async () => {
    render(<ChecksView worktreePath="/repo" worktreeId="wt-1" isActive={true} />)

    await waitFor(() => {
      expect(ipc.github.getPrStatus).toHaveBeenCalledWith('/repo', true)
    })
    vi.clearAllMocks()

    requestWorktreeRefresh('/repo', 'pr', { reason: 'pr-mutation', force: true })

    await waitFor(() => {
      expect(ipc.github.getPrStatus).toHaveBeenCalledWith('/repo', true)
      expect(ipc.jira.getIssuesForBranch).toHaveBeenCalledWith('/repo', undefined, false)
    })
  })

  it('does not write cache after an in-flight load resolves post-unmount', async () => {
    prCacheState.cache['/repo'] = { data: null, fetchedAt: 0, loading: false }
    let resolvePr!: (value: null) => void
    vi.mocked(ipc.github.getPrStatus).mockImplementationOnce(() =>
      new Promise((resolve) => { resolvePr = resolve })
    )

    const { unmount } = render(<ChecksView worktreePath="/repo" worktreeId="wt-1" isActive={true} />)

    await waitFor(() => {
      expect(ipc.github.getPrStatus).toHaveBeenCalled()
    })

    unmount()
    await act(async () => {
      resolvePr(null)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(prCacheState.cache['/repo']).toEqual({ data: null, fetchedAt: 0, loading: false })
  })

  it('opens the in-app Tasks PR detail from the PR header', async () => {
    prCacheState.cache['/repo'] = { data: basePr, fetchedAt: 123, loading: false }
    vi.mocked(ipc.github.getPrStatus).mockResolvedValue(basePr)

    render(<ChecksView worktreePath="/repo" worktreeId="wt-1" isActive={false} />)

    fireEvent.click(screen.getByText('#42'))

    expect(uiStoreState.openTaskPr).toHaveBeenCalledWith({
      detailBackTarget: 'worktree',
      projectId: 'project-1',
      projectName: 'repo',
      repoPath: '/repo',
      worktreeId: 'wt-1',
      matchingBranch: 'feature/pr-link',
      pr: {
        number: 42,
        title: 'Fix PR link routing',
        state: 'OPEN',
        url: 'https://github.com/example/repo/pull/42',
        headBranch: 'feature/pr-link',
        baseBranch: 'main',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: 'APPROVED',
        mergeStateStatus: 'CLEAN',
      },
    })
    expect(ipc.shell.openExternal).not.toHaveBeenCalled()
  })
})
