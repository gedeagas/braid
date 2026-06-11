import { describe, expect, it } from 'vitest'
import { isNwoResolutionError } from '../core'
import { GitHubTasks } from '../tasks'
import type {
  CheckRun,
  GitHubPrFile,
  GitHubPrDetail,
  GitHubPrFilePreview,
  GitHubReactionContent,
  GitHubWorkItem,
  GitHubReviewerSuggestion,
  GitHubLabelSuggestion,
  ListWorkItemsResult,
  PrGraphqlMetadata,
  PrIssueComment,
  PrReviewComment,
  PrReviewData,
} from '../types'

class TestGitHubTasks extends GitHubTasks {
  protected async hasRateLimitBudget(): Promise<boolean> {
    return true
  }

  protected async _resolveWorkItemRepo(): Promise<string | null> {
    return null
  }

  protected async _fetchChecksForPr(): Promise<CheckRun[]> {
    throw new Error('not implemented')
  }

  protected async _fetchReviewsForPr(): Promise<PrReviewData> {
    throw new Error('not implemented')
  }

  protected async _fetchIssueCommentsForPr(): Promise<PrIssueComment[]> {
    throw new Error('not implemented')
  }

  protected async _fetchFilesForPr(): Promise<GitHubPrFile[]> {
    throw new Error('not implemented')
  }

  protected async _fetchPrGraphqlMetadata(): Promise<PrGraphqlMetadata> {
    throw new Error('not implemented')
  }

  async getPrDetail(): Promise<GitHubPrDetail> {
    throw new Error('not implemented')
  }

  async getPrFilePreview(): Promise<GitHubPrFilePreview> {
    throw new Error('not implemented')
  }

  async requestPrReviewer(): Promise<boolean> {
    throw new Error('not implemented')
  }

  async removePrReviewer(): Promise<boolean> {
    throw new Error('not implemented')
  }

  async listReviewerSuggestions(): Promise<GitHubReviewerSuggestion[]> {
    throw new Error('not implemented')
  }

  async listLabelSuggestions(): Promise<GitHubLabelSuggestion[]> {
    throw new Error('not implemented')
  }

  async addPrComment(): Promise<PrIssueComment> {
    throw new Error('not implemented')
  }

  async replyToPrReviewComment(): Promise<PrReviewComment> {
    throw new Error('not implemented')
  }

  async addPrReviewComment(): Promise<PrReviewComment> {
    throw new Error('not implemented')
  }

  async submitPrReview(): Promise<boolean> {
    throw new Error('not implemented')
  }

  async resolvePrReviewThread(): Promise<boolean> {
    throw new Error('not implemented')
  }

  async setPrFileViewed(): Promise<boolean> {
    throw new Error('not implemented')
  }

  async addPrLabel(): Promise<boolean> {
    throw new Error('not implemented')
  }

  async removePrLabel(): Promise<boolean> {
    throw new Error('not implemented')
  }

  async rerunCheck(): Promise<boolean> {
    throw new Error('not implemented')
  }

  async toggleReaction(_repoPath: string, _number: number, _subjectId: string, _content: GitHubReactionContent): Promise<boolean> {
    throw new Error('not implemented')
  }
}

class CacheCoherenceGitHubTasks extends GitHubTasks {
  detailFetches = 0

  protected async hasRateLimitBudget(): Promise<boolean> {
    return true
  }

  protected async _fetchChecksForPr(): Promise<CheckRun[]> {
    return []
  }

  protected async _fetchReviewsForPr(): Promise<PrReviewData> {
    return { reviews: [], comments: [] }
  }

  protected async _fetchIssueCommentsForPr(): Promise<PrIssueComment[]> {
    return []
  }

  protected async _fetchFilesForPr(): Promise<GitHubPrFile[]> {
    return []
  }

  protected async _fetchPrGraphqlMetadata(): Promise<PrGraphqlMetadata> {
    return { pullRequestId: 'PR_kw', issueComments: [], reviewCommentThreads: new Map(), viewedStates: new Map() }
  }

  protected async _fetchPrDetail(): Promise<GitHubPrDetail> {
    this.detailFetches += 1
    return dirtyPrDetail()
  }

  protected async _fetchWorkItems(): Promise<ListWorkItemsResult> {
    return { items: [cleanPrWorkItem()] }
  }

  protected async _fetchPrSummary(): Promise<GitHubWorkItem> {
    return cleanPrWorkItem()
  }
}

function dirtyPrDetail(): GitHubPrDetail {
  return {
    item: {
      id: 'pr:42',
      type: 'pr',
      number: 42,
      title: 'Improve task view',
      state: 'open',
      url: 'https://github.com/example/repo/pull/42',
      author: 'author',
      labels: ['bug'],
      assignees: ['dev'],
      updatedAt: '2026-06-05T00:00:00Z',
      isDraft: false,
      headBranch: 'feature/task-view',
      baseBranch: 'main',
      mergeable: 'CONFLICTING',
      reviewDecision: 'APPROVED',
      mergeStateStatus: 'DIRTY',
      body: 'Detailed body',
      createdAt: '2026-06-01T00:00:00Z',
      pullRequestId: 'PR_kw',
      headRefOid: 'abc123',
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      commitsCount: 1,
      repoNameWithOwner: 'example/repo',
      reviewRequests: [],
      labelDetails: [{ name: 'bug', color: 'cc0000', description: null }],
    },
    checks: [],
    reviews: [],
    issueComments: [],
    comments: [],
    files: [],
  }
}

function cleanPrWorkItem(): GitHubWorkItem {
  return {
    id: 'pr:42',
    type: 'pr',
    number: 42,
    title: 'Improve task view',
    state: 'open',
    url: 'https://github.com/example/repo/pull/42',
    author: 'author',
    labels: ['bug'],
    assignees: ['dev'],
    updatedAt: '2026-06-06T00:00:00Z',
    isDraft: false,
    headBranch: 'feature/task-view',
    baseBranch: 'main',
    mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN',
  }
}

describe('GitHubTasks', () => {
  it('classifies missing git remotes as repository-resolution failures', () => {
    expect(isNwoResolutionError(new Error('Command failed: gh repo view\nno git remotes found'))).toBe(true)
  })

  it('returns empty work item data when a project has no GitHub repository', async () => {
    const service = new TestGitHubTasks()

    await expect(service.listWorkItems('/repo-without-remote')).resolves.toEqual({ items: [] })
    await expect(service.countWorkItems('/repo-without-remote')).resolves.toBe(0)
  })

  it('updates cached PR detail summaries from refreshed PR list results', async () => {
    const service = new CacheCoherenceGitHubTasks()

    await expect(service.getPrDetail('/repo', 42)).resolves.toMatchObject({
      item: { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', body: 'Detailed body' },
    })
    await service.listWorkItems('/repo', 50, 'is:pr is:open', true)

    await expect(service.getPrDetail('/repo', 42)).resolves.toMatchObject({
      item: { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: 'Detailed body' },
    })
    expect(service.detailFetches).toBe(1)
  })

  it('updates cached PR detail summaries from lightweight summary fetches', async () => {
    const service = new CacheCoherenceGitHubTasks()

    await expect(service.getPrDetail('/repo', 42)).resolves.toMatchObject({
      item: { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', body: 'Detailed body' },
    })
    await expect(service.getPrSummary('/repo', 42, true)).resolves.toMatchObject({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
    })

    await expect(service.getPrDetail('/repo', 42)).resolves.toMatchObject({
      item: { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: 'Detailed body' },
    })
    expect(service.detailFetches).toBe(1)
  })
})
