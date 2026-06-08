import { describe, expect, it } from 'vitest'
import { isNwoResolutionError } from '../core'
import { GitHubTasks } from '../tasks'
import type {
  CheckRun,
  GitHubPrFile,
  GitHubPrDetail,
  GitHubPrFilePreview,
  GitHubReactionContent,
  GitHubReviewerSuggestion,
  GitHubLabelSuggestion,
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

describe('GitHubTasks', () => {
  it('classifies missing git remotes as repository-resolution failures', () => {
    expect(isNwoResolutionError(new Error('Command failed: gh repo view\nno git remotes found'))).toBe(true)
  })

  it('returns empty work item data when a project has no GitHub repository', async () => {
    const service = new TestGitHubTasks()

    await expect(service.listWorkItems('/repo-without-remote')).resolves.toEqual({ items: [] })
    await expect(service.countWorkItems('/repo-without-remote')).resolves.toBe(0)
  })
})
