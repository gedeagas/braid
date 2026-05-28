import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PrReviewData } from '@/types'
import { CodeReviewView } from '../CodeReviewView'
import { github, shell } from '@/lib/ipc'

const mockUi = vi.hoisted(() => ({
  closeCodeReview: vi.fn(),
  openFile: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number; reviewCount?: number; commentCount?: number }) => {
      const label = key.includes(':') ? key.split(':').pop()! : key
      if (opts?.reviewCount != null && opts?.commentCount != null) {
        return `${label}:${opts.reviewCount}/${opts.commentCount}`
      }
      return opts?.count != null ? `${label}:${opts.count}` : label
    },
  }),
}))

vi.mock('@/lib/ipc', () => ({
  github: { getReviews: vi.fn(), replyToReviewComment: vi.fn() },
  shell: { openExternal: vi.fn() },
}))

vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (state: unknown) => unknown) => selector(mockUi),
}))

vi.mock('@/hooks/useShikiHighlight', () => ({
  useShikiHighlight: () => null,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const reviewData: PrReviewData = {
  reviews: [
    {
      id: 10,
      author: 'reviewer',
      authorAvatarUrl: '',
      state: 'APPROVED',
      body: 'Review **summary**',
      submittedAt: '2026-05-27T10:00:00Z',
      htmlUrl: 'https://github.com/example/repo/pull/1#pullrequestreview-10',
    },
  ],
  comments: [
    {
      id: 1,
      reviewId: 10,
      author: 'resolved-user',
      authorAvatarUrl: '',
      body: 'Resolved body',
      path: 'src/resolved.ts',
      line: 4,
      originalLine: 4,
      side: 'RIGHT',
      diffHunk: '',
      createdAt: '2026-05-27T09:00:00Z',
      updatedAt: '2026-05-27T09:00:00Z',
      htmlUrl: 'https://github.com/example/repo/pull/1#discussion_r1',
      inReplyToId: null,
      isResolved: true,
    },
    {
      id: 2,
      reviewId: 10,
      author: 'open-user',
      authorAvatarUrl: '',
      body: 'See [docs](https://example.com/docs).\n\n```ts\nconst value = 1\n```',
      path: 'src/open.ts',
      line: 12,
      originalLine: 12,
      side: 'RIGHT',
      diffHunk: '@@ -1,1 +1,1 @@\n-const value = 0\n+const value = 1',
      createdAt: '2026-05-27T11:00:00Z',
      updatedAt: '2026-05-27T11:00:00Z',
      htmlUrl: 'https://github.com/example/repo/pull/1#discussion_r2',
      inReplyToId: null,
      isResolved: false,
    },
  ],
}

describe('CodeReviewView', () => {
  it('renders overview stats and markdown comment bodies in the full review view', async () => {
    vi.mocked(github.getReviews).mockResolvedValue(reviewData)

    render(<CodeReviewView worktreePath="/repo" />)

    expect(await screen.findByText('codeReviewStatsOpen')).toBeDefined()
    expect(screen.getByText('codeReviewStatsResolved')).toBeDefined()
    expect(screen.getAllByText('const value = 1').length).toBeGreaterThan(0)
    expect(screen.getByText('summary')).toBeDefined()
    expect(screen.getByText('src/open.ts')).toBeDefined()
  })

  it('opens only safe markdown links and suppresses markdown images', async () => {
    const dataWithLinks: PrReviewData = {
      ...reviewData,
      comments: reviewData.comments.map((comment) => comment.id === 2 ? {
        ...comment,
        body: [
          'See [docs](https://example.com/docs).',
          'Open [relative](/example/repo/issues/1).',
          'Ignore [unsafe](file:///tmp/secret).',
          '![tracking pixel](https://tracking.example/pixel.png)',
        ].join('\n\n'),
      } : comment),
    }
    vi.mocked(github.getReviews).mockResolvedValue(dataWithLinks)

    const { container } = render(<CodeReviewView worktreePath="/repo" />)
    fireEvent.click(await screen.findByRole('link', { name: 'docs' }))
    fireEvent.click(screen.getByRole('link', { name: 'relative' }))
    fireEvent.click(screen.getByText('unsafe'))

    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/example/repo/issues/1')
    expect(shell.openExternal).not.toHaveBeenCalledWith('file:///tmp/secret')
    expect(shell.openExternal).not.toHaveBeenCalledWith('https://github.com/example/repo/pull/1#discussion_r2')
    expect(container.querySelector('.code-review-markdown img')).toBeNull()
  })

  it('opens files from file headers', async () => {
    vi.mocked(github.getReviews).mockResolvedValue(reviewData)

    render(<CodeReviewView worktreePath="/repo" />)
    fireEvent.click(await screen.findByText('src/open.ts'))

    expect(mockUi.openFile).toHaveBeenCalledWith('/repo/src/open.ts')
  })

  it('posts replies to top-level review comments and refreshes reviews', async () => {
    vi.mocked(github.getReviews).mockResolvedValue(reviewData)
    vi.mocked(github.replyToReviewComment).mockResolvedValue(undefined)

    render(<CodeReviewView worktreePath="/repo" />)
    const replyButtons = await screen.findAllByRole('button', { name: 'codeReviewReply' })
    fireEvent.click(replyButtons[0])
    fireEvent.change(screen.getByPlaceholderText('codeReviewReplyPlaceholder'), {
      target: { value: 'Thanks, I fixed this.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'codeReviewSendReply' }))

    await waitFor(() => {
      expect(github.replyToReviewComment).toHaveBeenCalledWith('/repo', 2, 'Thanks, I fixed this.')
    })
    expect(github.getReviews).toHaveBeenLastCalledWith('/repo', true)
  })

  it('preserves reply drafts when switching between comment composers', async () => {
    vi.mocked(github.getReviews).mockResolvedValue(reviewData)

    render(<CodeReviewView worktreePath="/repo" />)
    const replyButtons = await screen.findAllByRole('button', { name: 'codeReviewReply' })
    fireEvent.click(replyButtons[0])
    fireEvent.change(screen.getByPlaceholderText('codeReviewReplyPlaceholder'), {
      target: { value: 'Draft for open comment' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'codeReviewReply' }))
    fireEvent.change(screen.getByPlaceholderText('codeReviewReplyPlaceholder'), {
      target: { value: 'Draft for resolved comment' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'codeReviewReply' }))

    expect(screen.getByDisplayValue('Draft for open comment')).toBeDefined()
  })

  it('keeps the composer open when posting a reply fails', async () => {
    vi.mocked(github.getReviews).mockResolvedValue(reviewData)
    vi.mocked(github.replyToReviewComment).mockRejectedValue(new Error('nope'))

    render(<CodeReviewView worktreePath="/repo" />)
    const replyButtons = await screen.findAllByRole('button', { name: 'codeReviewReply' })
    fireEvent.click(replyButtons[0])
    fireEvent.change(screen.getByPlaceholderText('codeReviewReplyPlaceholder'), {
      target: { value: 'Retry me' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'codeReviewSendReply' }))

    expect(await screen.findByText('codeReviewReplyFailed')).toBeDefined()
    expect(screen.getByDisplayValue('Retry me')).toBeDefined()
  })

  it('does not report a failed reply when the post succeeds but refresh fails', async () => {
    vi.mocked(github.getReviews)
      .mockResolvedValueOnce(reviewData)
      .mockRejectedValueOnce(new Error('refresh failed'))
    vi.mocked(github.replyToReviewComment).mockResolvedValue(undefined)

    render(<CodeReviewView worktreePath="/repo" />)
    const replyButtons = await screen.findAllByRole('button', { name: 'codeReviewReply' })
    fireEvent.click(replyButtons[0])
    fireEvent.change(screen.getByPlaceholderText('codeReviewReplyPlaceholder'), {
      target: { value: 'Posted already' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'codeReviewSendReply' }))

    await waitFor(() => {
      expect(github.getReviews).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByText('codeReviewReplyFailed')).toBeNull()
    expect(screen.getByText('src/open.ts')).toBeDefined()
  })
})
