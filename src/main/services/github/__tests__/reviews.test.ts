import { describe, expect, it } from 'vitest'
import { GitHubReviews } from '../reviews'

class TestGitHubReviews extends GitHubReviews {
  constructor(private readonly raw: string) {
    super()
  }

  async fetchMetadata() {
    return this._fetchPrGraphqlMetadata('/repo', 'owner/name', 123)
  }

  protected async hasRateLimitBudget(): Promise<boolean> {
    return true
  }

  protected async gh(): Promise<string> {
    return this.raw
  }
}

describe('GitHubReviews', () => {
  it('skips null GraphQL nodes while preserving valid PR metadata', async () => {
    const service = new TestGitHubReviews(JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            id: 'PR_node',
            comments: {
              nodes: [
                null,
                {
                  id: 'issue_comment_node',
                  databaseId: 10,
                  author: { __typename: 'User', login: 'reviewer', avatarUrl: 'https://avatar.example/reviewer.png' },
                  body: 'Looks good',
                  createdAt: '2026-06-05T00:00:00Z',
                  updatedAt: '2026-06-05T00:00:00Z',
                  url: 'https://github.com/owner/name/pull/123#issuecomment-10',
                  reactionGroups: [{ content: 'HEART', viewerHasReacted: true, reactors: { totalCount: 1 } }],
                },
              ],
            },
            files: {
              nodes: [null, { path: 'src/app.ts', viewerViewedState: 'VIEWED' }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            reviewThreads: {
              nodes: [
                null,
                {
                  id: 'thread_node',
                  isResolved: true,
                  isOutdated: false,
                  line: 42,
                  startLine: null,
                  originalLine: 41,
                  originalStartLine: null,
                  comments: {
                    nodes: [
                      null,
                      {
                        id: 'review_comment_node',
                        databaseId: 20,
                        author: { __typename: 'Bot', login: 'github-actions', avatarUrl: 'https://avatar.example/bot.png' },
                        body: 'Inline note',
                        createdAt: '2026-06-05T00:00:00Z',
                        url: 'https://github.com/owner/name/pull/123#discussion_r20',
                        reactionGroups: [{ content: 'EYES', viewerHasReacted: false, reactors: { totalCount: 2 } }],
                      },
                    ],
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }))

    const metadata = await service.fetchMetadata()

    expect(metadata.pullRequestId).toBe('PR_node')
    expect(metadata.issueComments).toHaveLength(1)
    expect(metadata.issueComments[0]).toMatchObject({
      id: 10,
      subjectId: 'issue_comment_node',
      author: 'reviewer',
      reactions: [{ content: 'HEART', count: 1, viewerHasReacted: true }],
    })
    expect(metadata.viewedStates.get('src/app.ts')).toBe('VIEWED')
    expect(metadata.reviewCommentThreads.get(20)).toMatchObject({
      threadId: 'thread_node',
      isResolved: true,
      isOutdated: false,
      line: 42,
      subjectId: 'review_comment_node',
      author: 'github-actions',
      isBot: true,
      reactions: [{ content: 'EYES', count: 2, viewerHasReacted: false }],
    })
  })
})
