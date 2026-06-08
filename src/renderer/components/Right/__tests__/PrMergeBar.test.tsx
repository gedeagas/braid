import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrStatus } from '@/store/prCache'
import { PrMergeBar } from '../PrMergeBar'

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

let prStatus: PrStatus | null | undefined = basePr

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
  setActiveCenterView: vi.fn(),
  openTaskPr: vi.fn(),
  mergeConflictPrompt: '',
}

vi.mock('@/lib/ipc', () => ({
  cleanIpcError: vi.fn((_err: unknown, fallback: string) => fallback),
  github: {
    mergePr: vi.fn(),
    markPrReady: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock('@/store/prCache', () => ({
  usePrStatus: vi.fn(() => prStatus),
  usePrCacheStore: {
    getState: () => ({ cache: {} }),
    setState: vi.fn(),
  },
}))

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

vi.mock('@/store/ui', () => ({
  useUIStore: vi.fn((selector: (state: typeof uiStoreState) => unknown) => selector(uiStoreState)),
}))

vi.mock('@/store/flash', () => ({ flash: vi.fn() }))
vi.mock('@/lib/worktreeRefresh', () => ({ requestWorktreeRefresh: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('PrMergeBar', () => {
  let ipc: typeof import('@/lib/ipc')

  beforeEach(async () => {
    vi.clearAllMocks()
    prStatus = basePr
    ipc = await import('@/lib/ipc')
  })

  afterEach(() => {
    cleanup()
  })

  it('opens the in-app Tasks PR detail from the PR badge', () => {
    render(<PrMergeBar worktreePath="/repo" worktreeId="wt-1" />)

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
