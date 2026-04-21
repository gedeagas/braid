// ─── PR Code Review types ────────────────────────────────────────────────────

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED'

export interface PrReview {
  id: number
  author: string
  authorAvatarUrl: string
  state: ReviewState
  body: string
  submittedAt: string
  htmlUrl: string
}

export interface PrReviewComment {
  id: number
  reviewId: number
  author: string
  authorAvatarUrl: string
  body: string
  path: string
  line: number | null
  originalLine: number | null
  side: 'LEFT' | 'RIGHT'
  diffHunk: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
  inReplyToId: number | null
}

export interface PrReviewData {
  reviews: PrReview[]
  comments: PrReviewComment[]
}
