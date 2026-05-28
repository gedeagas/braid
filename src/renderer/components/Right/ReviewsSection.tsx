/**
 * ReviewsSection - renders PR code reviews inline in the Checks tab.
 *
 * Shows a compact PR review summary in the Checks tab.
 * A "See all" button opens the full review panel for complete threads.
 */
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { formatRelativeTime } from '@/lib/relativeTime'
import type { PrReview, PrReviewData, ReviewState } from '@/types'

const MAX_INLINE_REVIEWS = 3

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

function ReviewActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="checks-action-btn checks-action-btn--secondary" onClick={onClick}>
      {label}
    </button>
  )
}

function handleKeyboardActivate(e: KeyboardEvent<HTMLElement>, onClick: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onClick()
  }
}

function ReviewAvatar({ author, avatarUrl }: { author: string; avatarUrl: string }) {
  if (avatarUrl) {
    return <img className="review-avatar" src={avatarUrl} alt={author} />
  }
  return <span className="review-avatar-fallback">{author.trim().charAt(0) || '?'}</span>
}

function ReviewCard({ review, onClick }: { review: PrReview; onClick: () => void }) {
  return (
    <div
      className="review-summary-row"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => handleKeyboardActivate(e, onClick)}
    >
      <ReviewAvatar author={review.author} avatarUrl={review.authorAvatarUrl} />
      <div className="review-preview-content">
        <div className="review-preview-header">
          <span className="review-author">{review.author}</span>
          <ReviewStateBadge state={review.state} />
          <span className="review-preview-time">{formatRelativeTime(review.submittedAt)}</span>
        </div>
      </div>
    </div>
  )
}

export function ReviewsSection({ reviews, onOpenReview }: ReviewsSectionProps) {
  const { t } = useTranslation('right')

  const latestReviews = dedupeReviews(reviews.reviews)
  const rootComments = reviews.comments.filter((c) => c.inReplyToId === null)
  if (latestReviews.length === 0 && rootComments.length === 0) return null

  const resolvedCount = rootComments.filter((c) => c.isResolved).length
  const unresolvedCount = rootComments.length - resolvedCount

  return (
    <div className="checks-section">
      <SectionHeader
        title={t('codeReviews')}
        count={latestReviews.length + rootComments.length || undefined}
        action={(
          <ReviewActionButton label={t('seeAllReviews')} onClick={onOpenReview} />
        )}
      />

      <div className="review-section-content">
        {rootComments.length > 0 && (
          <div
            className="review-summary-card"
            role="button"
            tabIndex={0}
            onClick={onOpenReview}
            onKeyDown={(e) => handleKeyboardActivate(e, onOpenReview)}
          >
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

        {latestReviews.length > 0 && (
          <div className="review-subsection">
            <div className="review-subsection-title">{t('reviewLatestReviews')}</div>
            {latestReviews.slice(0, MAX_INLINE_REVIEWS).map((review) => (
              <ReviewCard key={review.id} review={review} onClick={onOpenReview} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
