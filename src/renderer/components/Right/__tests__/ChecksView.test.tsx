import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestWorktreeRefresh, resetWorktreeRefreshForTests } from '@/lib/worktreeRefresh'
import { ChecksView } from '../ChecksView'

const prCacheState = {
  cache: {
    '/repo': { data: null, fetchedAt: 123, loading: false },
  },
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
  useProjectsStore: vi.fn((selector: (state: { projects: unknown[] }) => unknown) => selector({ projects: [] })),
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
  const uiStoreState = {
    jiraBaseUrl: '',
    openFile: vi.fn(),
    setActiveCenterView: vi.fn(),
    openCodeReview: vi.fn(),
    prPrompt: '',
  }
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
})
