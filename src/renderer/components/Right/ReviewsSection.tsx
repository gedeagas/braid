/**
 * ReviewsSection - renders PR code reviews inline in the Checks tab.
 *
 * Shows up to 3 deduplicated review rows (latest per author), each with
 * avatar, author name, state badge, and optional body snippet. A "See all"
 * button appears when there are more reviews or inline comments to explore.
 */
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/ui'
import { ActionButton } from './ChecksSections'
import type { PrReview, PrReviewData, ReviewState } from '@/types'

const MAX_INLINE = 3

interface ReviewsSectionProps {
  reviews: PrReviewData
  onOpenReview: () => void
}

/** Deduplicate reviews per author (keep latest), filter out PENDING. */
function dedupeReviews(reviews: PrReview[]): PrReview[] {
  const byAuthor = new Map<string, PrReview>()
  for (const r of reviews) {
    if (r.state === 'PENDING') continue
    const existing = byAuthor.get(r.author)
    if (!existing || new Date(r.submittedAt) > new Date(existing.submittedAt)) {
      byAuthor.set(r.author, r)
    }
  }
  return Array.from(byAuthor.values())
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
}

function reviewStateClass(state: ReviewState): string {
  switch (state) {
    case 'APPROVED': return 'review-state-badge--approved'
    case 'CHANGES_REQUESTED': return 'review-state-badge--changes_requested'
    case 'DISMISSED': return 'review-state-badge--dismissed'
    default: return 'review-state-badge--commented'
  }
}

function ReviewStateBadge({ state }: { state: ReviewState }) {
  const { t } = useTranslation('right')
  const labels: Record<ReviewState, string> = {
    APPROVED: t('reviewApproved'),
    CHANGES_REQUESTED: t('reviewChangesRequested'),
    COMMENTED: t('reviewCommented'),
    DISMISSED: t('reviewDismissed'),
    PENDING: '',
  }
  return (
    <span className={`review-state-badge ${reviewStateClass(state)}`}>
      {labels[state]}
    </span>
  )
}

function ReviewRow({ review, onClick }: { review: PrReview; onClick: () => void }) {
  return (
    <div className="review-row" onClick={onClick}>
      {review.authorAvatarUrl ? (
        <img className="review-avatar" src={review.authorAvatarUrl} alt={review.author} />
      ) : (
        <span className="review-avatar-fallback">{review.author[0]}</span>
      )}
      <span className="review-author">{review.author}</span>
      <ReviewStateBadge state={review.state} />
      {review.body && <span className="review-snippet">{review.body}</span>}
    </div>
  )
}

export function ReviewsSection({ reviews, onOpenReview }: ReviewsSectionProps) {
  const { t } = useTranslation('right')

  const latestReviews = dedupeReviews(reviews.reviews)
  if (latestReviews.length === 0 && reviews.comments.length === 0) return null

  const displayReviews = latestReviews.slice(0, MAX_INLINE)
  const hasMore = latestReviews.length > 0 || reviews.comments.length > 0

  // Count resolved/unresolved root comments
  const rootComments = reviews.comments.filter((c) => c.inReplyToId === null)
  const resolvedCount = rootComments.filter((c) => c.isResolved).length
  const unresolvedCount = rootComments.length - resolvedCount

  return (
    <div className="checks-section">
      <SectionHeader
        title={t('codeReviews')}
        count={latestReviews.length || undefined}
        action={hasMore ? (
          <ActionButton label={t('seeAllReviews')} onClick={onOpenReview} />
        ) : undefined}
      />
      <div className="checks-rows">
        {displayReviews.map((review) => (
          <ReviewRow key={review.id} review={review} onClick={onOpenReview} />
        ))}
        {rootComments.length > 0 && (
          <div className="review-row" onClick={onOpenReview}>
            <span className="review-thread-counts">
              {unresolvedCount > 0 && (
                <span className="review-thread-badge review-thread-badge--unresolved">
                  {t('reviewUnresolved', { count: unresolvedCount })}
                </span>
              )}
              {resolvedCount > 0 && (
                <span className="review-thread-badge review-thread-badge--resolved">
                  {t('reviewResolved', { count: resolvedCount })}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
