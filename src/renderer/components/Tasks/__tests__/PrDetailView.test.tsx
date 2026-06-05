import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskRow } from '../types'
import type { PrDetailController } from '../usePrDetailController'
import { PrDetailView } from '../PrDetailView'

vi.mock('@/lib/ipc', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'detail.backToWorkspace') return 'Workspace'
      if (key === 'detail.backToPullRequests') return 'Pull requests'
      return key
    },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}))

const baseRow: TaskRow = {
  projectId: 'project-1',
  projectName: 'repo',
  repoPath: '/repo',
  matchingWorktreeId: 'wt-1',
  matchingBranch: 'feature/pr-link',
  item: {
    id: 'pr:/repo:42',
    type: 'pr',
    number: 42,
    title: 'Fix PR link routing',
    state: 'open',
    url: 'https://github.com/example/repo/pull/42',
    author: 'author',
    labels: [],
    assignees: [],
    updatedAt: '2026-06-05T00:00:00Z',
    headBranch: 'feature/pr-link',
    baseBranch: 'main',
  },
}

function buildDetail(handleOpenMatchingWorktree = vi.fn()): PrDetailController {
  return {
    selectedRow: baseRow,
    review: {
      prActionError: null,
      setPrActionError: vi.fn(),
      creatingWorktreeForRowId: null,
      detailTab: 'description',
      setDetailTab: vi.fn(),
    },
    prDetail: null,
    prDetailLoading: false,
    prDetailError: null,
    filePreviews: {},
    detailItem: baseRow.item,
    selectedPrFile: null,
    selectedDiffLines: [],
    visibleDiffLines: [],
    diffSearchResult: { term: '', matches: [] },
    issueComments: [],
    reviewComments: [],
    rootReviewComments: [],
    reviewRepliesByParent: new Map(),
    inlineCommentsByPathLine: new Map(),
    timelineEntries: [],
    checkGroups: [],
    activityCounts: { all: 0, human: 0, bot: 0 },
    checks: { passedChecks: 0, failedChecks: 0, pendingChecks: 0, skippedChecks: 0 },
    detailMarkdownBaseUrl: baseRow.item.url,
    showReadyAction: false,
    showMergeActions: false,
    checkSummaryLabel: 'checks.summaryPassing',
    actions: {
      handleOpenMatchingWorktree,
      handleRefreshPrDetail: vi.fn(),
      handleCreateWorktreeForRow: vi.fn(),
    },
  } as unknown as PrDetailController
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PrDetailView', () => {
  it('returns to the matching worktree for PR details opened from a worktree surface', () => {
    const setSelectedRow = vi.fn()
    const handleOpenMatchingWorktree = vi.fn()

    render(
      <PrDetailView
        selectedRow={{ ...baseRow, detailBackTarget: 'worktree' }}
        setSelectedRow={setSelectedRow}
        detail={buildDetail(handleOpenMatchingWorktree)}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))

    expect(handleOpenMatchingWorktree).toHaveBeenCalledTimes(1)
    expect(setSelectedRow).toHaveBeenCalledWith(null)
  })

  it('returns to the Tasks PR list for normal task-list navigation', () => {
    const setSelectedRow = vi.fn()
    const handleOpenMatchingWorktree = vi.fn()

    render(
      <PrDetailView
        selectedRow={baseRow}
        setSelectedRow={setSelectedRow}
        detail={buildDetail(handleOpenMatchingWorktree)}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pull requests' }))

    expect(setSelectedRow).toHaveBeenCalledWith(null)
    expect(handleOpenMatchingWorktree).not.toHaveBeenCalled()
  })
})
