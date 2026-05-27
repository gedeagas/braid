import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PrReviewData } from '@/types'
import { ReviewsSection } from '../ReviewsSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => (
      opts?.count != null ? `${key}:${opts.count}` : key
    ),
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const baseReviewData: PrReviewData = {
  reviews: [
    {
      id: 10,
      author: 'reviewer',
      authorAvatarUrl: '',
      state: 'COMMENTED',
      body: 'Summary with **markdown**',
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
      body: 'Please check `value`.\n\n```ts\nconst value = 1\n```',
      path: 'src/open.ts',
      line: 12,
      originalLine: 12,
      side: 'RIGHT',
      diffHunk: '',
      createdAt: '2026-05-27T11:00:00Z',
      updatedAt: '2026-05-27T11:00:00Z',
      htmlUrl: 'https://github.com/example/repo/pull/1#discussion_r2',
      inReplyToId: null,
      isResolved: false,
    },
  ],
}

describe('ReviewsSection', () => {
  it('renders a compact summary and latest review states', () => {
    render(<ReviewsSection reviews={baseReviewData} onOpenReview={vi.fn()} />)

    expect(screen.getByText('reviewUnresolved:1')).toBeDefined()
    expect(screen.getByText('reviewResolved:1')).toBeDefined()
    expect(screen.getByText('reviewLatestReviews')).toBeDefined()
    expect(screen.getByText('reviewer')).toBeDefined()
    expect(screen.getByText('reviewCommented')).toBeDefined()
    expect(screen.queryByText('const value = 1')).toBeNull()
    expect(screen.queryByText('src/open.ts')).toBeNull()
  })

  it('opens the full review panel from the summary', () => {
    const onOpenReview = vi.fn()
    render(<ReviewsSection reviews={baseReviewData} onOpenReview={onOpenReview} />)

    fireEvent.click(screen.getByText('reviewUnresolved:1'))

    expect(onOpenReview).toHaveBeenCalledTimes(1)
  })

  it('always exposes the full review action when activity exists', () => {
    const onOpenReview = vi.fn()
    render(<ReviewsSection reviews={baseReviewData} onOpenReview={onOpenReview} />)

    fireEvent.click(screen.getByRole('button', { name: 'seeAllReviews' }))

    expect(onOpenReview).toHaveBeenCalledTimes(1)
  })
})
