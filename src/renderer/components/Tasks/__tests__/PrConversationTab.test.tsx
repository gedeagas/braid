import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrConversationTab } from '../PrConversationTab'
import type { UiReviewComment } from '../types'
import type { PrDetailController } from '../usePrDetailController'

vi.mock('@/lib/ipc', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function reviewComment(overrides: Partial<UiReviewComment> = {}): UiReviewComment {
  return {
    id: 1,
    subjectId: '',
    reviewId: 10,
    author: 'reviewer',
    authorAvatarUrl: '',
    isBot: false,
    body: 'Root comment',
    path: 'src/app.ts',
    line: 12,
    startLine: null,
    originalLine: 12,
    side: 'RIGHT',
    diffHunk: '',
    createdAt: '2026-06-05T00:00:00Z',
    updatedAt: '2026-06-05T00:00:00Z',
    htmlUrl: '',
    inReplyToId: null,
    threadId: 'thread-1',
    isResolved: false,
    isOutdated: false,
    reactions: [],
    ...overrides,
  }
}

function buildDetail(comments: UiReviewComment[], repliesByParent: Map<number, UiReviewComment[]>, setReplyingCommentId = vi.fn()): PrDetailController {
  const rootComments = comments.filter((comment) => comment.inReplyToId === null)
  return {
    prDetail: {
      item: {
        id: 'pr:/repo:42',
        type: 'pr',
        number: 42,
        title: 'Review thread',
        state: 'open',
        url: 'https://github.com/example/repo/pull/42',
        author: 'author',
        labels: [],
        assignees: [],
        updatedAt: '2026-06-05T00:00:00Z',
        body: '',
        createdAt: '2026-06-05T00:00:00Z',
        pullRequestId: 'PR_kw',
        headRefOid: 'abc123',
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        commitsCount: 1,
        repoNameWithOwner: 'example/repo',
        reviewRequests: [],
        labelDetails: [],
      },
      checks: [],
      reviews: [],
      issueComments: [],
      comments,
      files: [],
    },
    timelineEntries: rootComments.map((comment) => ({ kind: 'review-comment' as const, at: comment.createdAt, item: comment })),
    reviewRepliesByParent: repliesByParent,
    activityCounts: { all: rootComments.length, human: rootComments.length, bot: 0 },
    detailMarkdownBaseUrl: 'https://github.com/example/repo/pull/42',
    review: {
      activityFilter: 'all',
      setActivityFilter: vi.fn(),
      prCommentBody: '',
      setPrCommentBody: vi.fn(),
      commentError: null,
      setCommentError: vi.fn(),
      postingPrComment: false,
      reactingSubjectIds: new Set<string>(),
      expandedDiffCommentIds: new Set<number>(),
      toggleDiffExpansion: vi.fn(),
      resolvingThreadIds: new Set<string>(),
      replyingCommentId: null,
      setReplyingCommentId,
      replyBody: '',
      setReplyBody: vi.fn(),
      postingReplyId: null,
    },
    actions: {
      handleSubmitPrComment: vi.fn(),
      handleToggleReaction: vi.fn(),
      handleResolveThread: vi.fn(),
      handleSubmitReviewReply: vi.fn(),
    },
  } as unknown as PrDetailController
}

describe('PrConversationTab', () => {
  it('renders nested review replies and allows replying to a reply', () => {
    const root = reviewComment()
    const reply = reviewComment({ id: 2, body: 'First reply', inReplyToId: root.id })
    const nestedReply = reviewComment({ id: 3, body: 'Nested reply', inReplyToId: reply.id })
    const setReplyingCommentId = vi.fn()
    const repliesByParent = new Map<number, UiReviewComment[]>([
      [root.id, [reply]],
      [reply.id, [nestedReply]],
    ])

    render(<PrConversationTab detail={buildDetail([root, reply, nestedReply], repliesByParent, setReplyingCommentId)} />)

    expect(screen.getByText('Nested reply')).toBeDefined()

    expect(screen.getAllByText('conversation.replyPrompt')).toHaveLength(1)

    const replyActions = screen.getAllByRole('button', { name: 'conversation.reply' })
    expect(replyActions).toHaveLength(2)
    fireEvent.click(replyActions[0])

    expect(setReplyingCommentId).toHaveBeenCalledWith(reply.id)
  })
})
