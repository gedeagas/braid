import { describe, expect, it } from 'vitest'
import type { PrReview } from '../types'
import { shouldShowReviewTimelineEntry } from '../taskUtils'

function review(state: string, body = ''): PrReview {
  return {
    id: 1,
    author: 'reviewer',
    authorAvatarUrl: '',
    state,
    body,
    submittedAt: '2026-06-05T00:00:00Z',
    htmlUrl: 'https://github.com/owner/repo/pull/1#pullrequestreview-1',
  }
}

describe('shouldShowReviewTimelineEntry', () => {
  it('hides empty commented review shells', () => {
    expect(shouldShowReviewTimelineEntry(review('COMMENTED'))).toBe(false)
    expect(shouldShowReviewTimelineEntry(review('COMMENTED', '   '))).toBe(false)
  })

  it('keeps written review comments and review state changes', () => {
    expect(shouldShowReviewTimelineEntry(review('COMMENTED', 'LGTM'))).toBe(true)
    expect(shouldShowReviewTimelineEntry(review('APPROVED'))).toBe(true)
    expect(shouldShowReviewTimelineEntry(review('CHANGES_REQUESTED'))).toBe(true)
  })
})
