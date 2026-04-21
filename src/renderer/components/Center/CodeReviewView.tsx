/**
 * CodeReviewView - full code review panel in the center area.
 *
 * Shows all PR reviews (summary cards) and inline comments grouped by file.
 * Accessed from the Checks tab "See all" button or clicking a review row.
 */
import { useEffect, useReducer, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/store/ui'
import { EmptyState, Spinner } from '@/components/ui'
import { IconArrowLeft, IconFile } from '@/components/shared/icons'
import type { PrReview, PrReviewComment, PrReviewData, ReviewState } from '@/types'

// ─── State ──────────────────────────────────────────────────────────────────

interface State {
  data: PrReviewData | null
  loading: boolean
  error: boolean
}

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_DONE'; data: PrReviewData }
  | { type: 'LOAD_ERROR' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START': return { ...state, loading: true, error: false }
    case 'LOAD_DONE': return { data: action.data, loading: false, error: false }
    case 'LOAD_ERROR': return { ...state, loading: false, error: true }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function groupCommentsByFile(comments: PrReviewComment[]): Map<string, PrReviewComment[]> {
  const rootComments = comments.filter((c) => c.inReplyToId === null)
  const groups = new Map<string, PrReviewComment[]>()
  for (const c of rootComments) {
    const list = groups.get(c.path) ?? []
    list.push(c)
    groups.set(c.path, list)
  }
  // Sort by file path
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function getReplies(comments: PrReviewComment[], parentId: number): PrReviewComment[] {
  return comments
    .filter((c) => c.inReplyToId === parentId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffHrs = diffMs / (1000 * 60 * 60)
    if (diffHrs < 1) return `${Math.max(1, Math.round(diffMs / 60000))}m ago`
    if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`
    if (diffHrs < 168) return `${Math.round(diffHrs / 24)}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function reviewStateClass(state: ReviewState): string {
  switch (state) {
    case 'APPROVED': return 'review-state-badge--approved'
    case 'CHANGES_REQUESTED': return 'review-state-badge--changes_requested'
    case 'DISMISSED': return 'review-state-badge--dismissed'
    default: return 'review-state-badge--commented'
  }
}

function stateLabel(state: ReviewState, t: (key: string) => string): string {
  switch (state) {
    case 'APPROVED': return t('reviewApproved')
    case 'CHANGES_REQUESTED': return t('reviewChangesRequested')
    case 'COMMENTED': return t('reviewCommented')
    case 'DISMISSED': return t('reviewDismissed')
    default: return ''
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ReviewCard({ review, t }: { review: PrReview; t: (key: string) => string }) {
  const openUrl = () => ipc.shell.openExternal(review.htmlUrl)
  return (
    <div className="code-review-card" onClick={openUrl}>
      {review.authorAvatarUrl ? (
        <img className="code-review-card-avatar" src={review.authorAvatarUrl} alt={review.author} />
      ) : (
        <span className="review-avatar-fallback" style={{ width: 28, height: 28, fontSize: 'var(--text-base)' }}>
          {review.author[0]}
        </span>
      )}
      <div className="code-review-card-content">
        <div className="code-review-card-header">
          <span className="code-review-card-author">{review.author}</span>
          <span className={`review-state-badge ${reviewStateClass(review.state)}`}>
            {stateLabel(review.state, t)}
          </span>
          <span className="code-review-card-time">{formatTime(review.submittedAt)}</span>
        </div>
        {review.body && <div className="code-review-card-body">{review.body}</div>}
      </div>
    </div>
  )
}

function CommentItem({
  comment, allComments, t,
}: {
  comment: PrReviewComment
  allComments: PrReviewComment[]
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const openUrl = () => ipc.shell.openExternal(comment.htmlUrl)
  const replies = getReplies(allComments, comment.id)

  return (
    <>
      <div className="code-review-comment" onClick={openUrl}>
        {comment.authorAvatarUrl ? (
          <img className="code-review-comment-avatar" src={comment.authorAvatarUrl} alt={comment.author} />
        ) : (
          <span className="review-avatar-fallback" style={{ width: 24, height: 24 }}>
            {comment.author[0]}
          </span>
        )}
        <div className="code-review-comment-content">
          <div className="code-review-comment-header">
            <span className="code-review-comment-author">{comment.author}</span>
            {comment.line && (
              <span className="code-review-comment-line">{t('codeReviewLine', { line: comment.line })}</span>
            )}
            <span className="code-review-comment-time">{formatTime(comment.createdAt)}</span>
          </div>
          {comment.diffHunk && (
            <div className="code-review-diff-hunk">
              {comment.diffHunk.split('\n').slice(-4).join('\n')}
            </div>
          )}
          <div className="code-review-comment-body">{comment.body}</div>
        </div>
      </div>
      {replies.length > 0 && (
        <div className="code-review-comment-thread">
          {replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} allComments={allComments} t={t} />
          ))}
        </div>
      )}
    </>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

interface Props {
  worktreePath: string
}

export function CodeReviewView({ worktreePath }: Props) {
  const { t } = useTranslation(['center', 'right'])
  const [state, dispatch] = useReducer(reducer, { data: null, loading: true, error: false })
  const openFile = useUIStore((s) => s.openFile)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)

  const load = useCallback(async () => {
    dispatch({ type: 'LOAD_START' })
    try {
      const data = await ipc.github.getReviews(worktreePath) as PrReviewData
      dispatch({ type: 'LOAD_DONE', data })
    } catch {
      dispatch({ type: 'LOAD_ERROR' })
    }
  }, [worktreePath])

  useEffect(() => { load() }, [load])

  const dedupedReviews = useMemo(
    () => state.data ? dedupeReviews(state.data.reviews) : [],
    [state.data],
  )

  const fileGroups = useMemo(
    () => state.data ? groupCommentsByFile(state.data.comments) : new Map<string, PrReviewComment[]>(),
    [state.data],
  )

  const inlineCount = state.data?.comments.filter((c) => c.inReplyToId === null).length ?? 0

  const handleBack = useCallback(() => {
    // Go back to the most recent session view
    const sessions = useUIStore.getState()
    const worktreeId = sessions.selectedWorktreeId
    if (worktreeId) {
      const acv = sessions.activeCenterViewByWorktree[worktreeId]
      if (acv && acv.type !== 'codeReview') {
        setActiveCenterView(acv)
        return
      }
    }
    setActiveCenterView(null)
  }, [setActiveCenterView])

  const handleOpenFile = useCallback((path: string) => {
    // File paths from GitHub are relative to repo root, which matches worktree
    const fullPath = worktreePath + '/' + path
    openFile(fullPath)
  }, [worktreePath, openFile])

  if (state.loading) {
    return (
      <div className="code-review-view">
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size="md" />
        </div>
      </div>
    )
  }

  if (state.error || !state.data) {
    return (
      <div className="code-review-view">
        <CodeReviewHeader onBack={handleBack} t={t} />
        <EmptyState title={t('center:codeReviewEmpty')} hint={t('center:codeReviewEmptyHint')} />
      </div>
    )
  }

  if (dedupedReviews.length === 0 && inlineCount === 0) {
    return (
      <div className="code-review-view">
        <CodeReviewHeader onBack={handleBack} t={t} />
        <EmptyState title={t('center:codeReviewEmpty')} hint={t('center:codeReviewEmptyHint')} />
      </div>
    )
  }

  return (
    <div className="code-review-view">
      <CodeReviewHeader
        onBack={handleBack}
        t={t}
        summary={t('center:codeReviewSummary', { reviewCount: dedupedReviews.length, commentCount: inlineCount })}
      />
      <div className="code-review-body">
        {/* Review summary cards */}
        {dedupedReviews.length > 0 && (
          <div className="code-review-reviews">
            {dedupedReviews.map((review) => (
              <ReviewCard key={review.id} review={review} t={(k) => t(`right:${k}`)} />
            ))}
          </div>
        )}

        {/* Inline comments grouped by file */}
        {Array.from(fileGroups.entries()).map(([filePath, comments]) => (
          <div key={filePath} className="code-review-file-group">
            <div className="code-review-file-header">
              <span className="code-review-file-icon"><IconFile size={14} /></span>
              <span className="code-review-file-path" onClick={() => handleOpenFile(filePath)}>
                {filePath}
              </span>
              <span className="code-review-file-count">
                {t('right:reviewComments', { count: comments.length })}
              </span>
            </div>
            <div className="code-review-comments">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  allComments={state.data!.comments}
                  t={(k, opts) => t(`center:${k}`, opts as Record<string, string>)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CodeReviewHeader({
  onBack, t, summary,
}: {
  onBack: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
  summary?: string
}) {
  return (
    <div className="code-review-header">
      <button className="code-review-header-back" onClick={onBack}>
        <IconArrowLeft size={16} />
      </button>
      <span className="code-review-header-title">{t('center:codeReviewTitle')}</span>
      {summary && <span className="code-review-header-summary">{summary}</span>}
    </div>
  )
}
