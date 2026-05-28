/**
 * CodeReviewView - full code review panel in the center area.
 *
 * Shows all PR reviews (summary cards) and inline comments grouped by file.
 * Accessed from the Checks tab "See all" button or clicking a review row.
 */
import { useEffect, useReducer, useCallback, useMemo, memo, useState, type MouseEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { useTranslation } from 'react-i18next'
import remarkGfm from 'remark-gfm'
import * as ipc from '@/lib/ipc'
import { formatRelativeTime } from '@/lib/relativeTime'
import { resolveSafeExternalUrl } from '@/lib/safeExternalUrl'
import { useUIStore } from '@/store/ui'
import { EmptyState, Spinner } from '@/components/ui'
import { IconFile } from '@/components/shared/icons'
import { useShikiHighlight } from '@/hooks/useShikiHighlight'
import type { PrReview, PrReviewComment, PrReviewData, ReviewState } from '@/types'

// ─── State ──────────────────────────────────────────────────────────────────

type FilterMode = 'all' | 'unresolved' | 'resolved'

interface State {
  data: PrReviewData | null
  loading: boolean
  error: boolean
  filter: FilterMode
}

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_DONE'; data: PrReviewData }
  | { type: 'LOAD_ERROR' }
  | { type: 'SET_FILTER'; filter: FilterMode }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START': return { ...state, loading: true, error: false }
    case 'LOAD_DONE': return { ...state, data: action.data, loading: false, error: false }
    case 'LOAD_ERROR': return { ...state, loading: false, error: true }
    case 'SET_FILTER': return { ...state, filter: action.filter }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const markdownPlugins = [remarkGfm]

function createMarkdownComponents(baseUrl: string): Components {
  return {
    a: ({ href, children }) => {
      const safeUrl = resolveSafeExternalUrl(href, baseUrl)
      const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault()
        e.stopPropagation()
        if (safeUrl) ipc.shell.openExternal(safeUrl)
      }
      return <a href={safeUrl ?? undefined} onClick={onClick}>{children}</a>
    },
    img: () => null,
  }
}

const getOpenCount = (comments: PrReviewComment[]) => comments.reduce(
  (count, comment) => count + (comment.isResolved ? 0 : 1),
  0,
)

function groupCommentsByFile(comments: PrReviewComment[]): Map<string, PrReviewComment[]> {
  const rootComments = comments.filter((c) => c.inReplyToId === null)
  const groups = new Map<string, PrReviewComment[]>()
  for (const c of rootComments) {
    const list = groups.get(c.path) ?? []
    list.push(c)
    groups.set(c.path, list)
  }

  const entries = Array.from(groups.entries()).map(([path, groupComments]) => {
    groupComments.sort(compareComments)
    return { path, comments: groupComments, openCount: getOpenCount(groupComments) }
  })

  entries.sort((a, b) => {
    if (a.openCount !== b.openCount) return b.openCount - a.openCount
    return a.path.localeCompare(b.path)
  })

  return new Map(entries.map(({ path, comments }) => [path, comments]))
}

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

function compareComments(a: PrReviewComment, b: PrReviewComment): number {
  const resolution = Number(a.isResolved) - Number(b.isResolved)
  if (resolution !== 0) return resolution
  const aLine = a.line ?? a.originalLine ?? Number.MAX_SAFE_INTEGER
  const bLine = b.line ?? b.originalLine ?? Number.MAX_SAFE_INTEGER
  if (aLine !== bLine) return aLine - bLine
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

function getReplies(comments: PrReviewComment[], parentId: number): PrReviewComment[] {
  return comments
    .filter((c) => c.inReplyToId === parentId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
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

function CodeReviewMarkdown({ body, baseUrl }: { body: string; baseUrl: string }) {
  const components = useMemo(() => createMarkdownComponents(baseUrl), [baseUrl])
  if (!body.trim()) return null
  return (
    <div className="code-review-markdown">
      <ReactMarkdown skipHtml remarkPlugins={markdownPlugins} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  )
}

// ─── Diff hunk renderer with Shiki syntax highlighting ───────────────────────

const DiffHunk = memo(function DiffHunk({ raw, filePath }: { raw: string; filePath: string }) {
  const lines = useMemo(() => raw.split('\n').slice(-6), [raw])

  // Strip diff markers (+/-/space/@@) to get pure code for Shiki
  const codeLines = useMemo(
    () => lines.map((l) => (l.startsWith('@@') ? '' : l.slice(1))),
    [lines],
  )

  const highlighted = useShikiHighlight(codeLines, filePath)

  return (
    <div className="code-review-diff-hunk">
      {lines.map((line, i) => {
        let cls = 'cr-diff-line cr-diff-ctx'
        let gutter = ' '
        if (line.startsWith('@@')) {
          cls = 'cr-diff-line cr-diff-range'
          gutter = ''
        } else if (line.startsWith('+')) {
          cls = 'cr-diff-line cr-diff-add'
          gutter = '+'
        } else if (line.startsWith('-')) {
          cls = 'cr-diff-line cr-diff-del'
          gutter = '-'
        }

        const html = highlighted?.[i]
        const isRange = line.startsWith('@@')

        return (
          <div key={i} className={cls}>
            {gutter !== '' && <span className="cr-diff-gutter">{gutter}</span>}
            {html && !isRange ? (
              <span className="cr-diff-content" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <span className="cr-diff-content">{isRange ? line : line.slice(1)}</span>
            )}
          </div>
        )
      })}
    </div>
  )
})

// ─── Sub-components ─────────────────────────────────────────────────────────

function ReviewCard({ review, t }: { review: PrReview; t: (key: string) => string }) {
  const openUrl = () => ipc.shell.openExternal(review.htmlUrl)
  return (
    <div
      className="code-review-card"
      role="button"
      tabIndex={0}
      onClick={openUrl}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUrl() } }}
    >
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
          <span className="code-review-card-time">{formatRelativeTime(review.submittedAt)}</span>
        </div>
        <CodeReviewMarkdown body={review.body} baseUrl={review.htmlUrl} />
      </div>
    </div>
  )
}

function CommentItem({
  comment, allComments, isRoot, replyState, t,
}: {
  comment: PrReviewComment
  allComments: PrReviewComment[]
  isRoot?: boolean
  replyState?: ReplyState
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const openUrl = () => ipc.shell.openExternal(comment.htmlUrl)
  const replies = getReplies(allComments, comment.id)
  const resolvedClass = comment.isResolved ? ' code-review-comment--resolved' : ''

  return (
    <>
      <div
        className={`code-review-comment${resolvedClass}`}
        role="button"
        tabIndex={0}
        onClick={openUrl}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUrl() } }}
      >
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
            {isRoot && (
              <span className={`code-review-resolved-badge ${comment.isResolved ? 'code-review-resolved-badge--resolved' : 'code-review-resolved-badge--open'}`}>
                {comment.isResolved ? t('codeReviewResolved') : t('codeReviewOpen')}
              </span>
            )}
            <span className="code-review-comment-time">{formatRelativeTime(comment.createdAt)}</span>
          </div>
          {comment.diffHunk && <DiffHunk raw={comment.diffHunk} filePath={comment.path} />}
          <CodeReviewMarkdown body={comment.body} baseUrl={comment.htmlUrl} />
        </div>
      </div>
      {replies.length > 0 && (
        <div className="code-review-comment-thread">
          {replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} allComments={allComments} t={t} />
          ))}
        </div>
      )}
      {isRoot && replyState && (
        <ReplySlot commentId={comment.id} replyState={replyState} t={t} />
      )}
    </>
  )
}

interface ReplyState {
  replyingToId: number | null
  draft: string
  submittingId: number | null
  error: string | null
  onStart: (commentId: number) => void
  onCancel: () => void
  onDraftChange: (value: string) => void
  onSubmit: (commentId: number) => void
}

function ReplySlot({
  commentId, replyState, t,
}: {
  commentId: number
  replyState: ReplyState
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const isActive = replyState.replyingToId === commentId
  const isSubmitting = replyState.submittingId === commentId

  if (!isActive) {
    return (
      <div className="code-review-reply-slot">
        <button className="code-review-reply-button" onClick={() => replyState.onStart(commentId)}>
          {t('codeReviewReply')}
        </button>
      </div>
    )
  }

  return (
    <div className="code-review-reply-slot">
      <div className="code-review-reply-composer">
        <textarea
          className="code-review-reply-textarea"
          value={replyState.draft}
          onChange={(e) => replyState.onDraftChange(e.target.value)}
          placeholder={t('codeReviewReplyPlaceholder')}
          rows={4}
          disabled={isSubmitting}
          autoFocus
        />
        {replyState.error && <div className="code-review-reply-error">{replyState.error}</div>}
        <div className="code-review-reply-actions">
          <button
            className="code-review-reply-cancel"
            onClick={replyState.onCancel}
            disabled={isSubmitting}
          >
            {t('codeReviewCancelReply')}
          </button>
          <button
            className="code-review-reply-submit"
            onClick={() => replyState.onSubmit(commentId)}
            disabled={isSubmitting || !replyState.draft.trim()}
          >
            {isSubmitting ? t('codeReviewSendingReply') : t('codeReviewSendReply')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

interface Props {
  worktreePath: string
}

export function CodeReviewView({ worktreePath }: Props) {
  const { t } = useTranslation(['center', 'right'])
  const [state, dispatch] = useReducer(reducer, { data: null, loading: true, error: false, filter: 'all' })
  const [replyingToId, setReplyingToId] = useState<number | null>(null)
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [submittingReplyId, setSubmittingReplyId] = useState<number | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)
  const openFile = useUIStore((s) => s.openFile)

  const load = useCallback(async (forceRefresh = false, showLoading = true) => {
    if (showLoading) dispatch({ type: 'LOAD_START' })
    try {
      const data = await ipc.github.getReviews(worktreePath, forceRefresh) as PrReviewData
      dispatch({ type: 'LOAD_DONE', data })
      return true
    } catch {
      if (showLoading) dispatch({ type: 'LOAD_ERROR' })
      return false
    }
  }, [worktreePath])

  useEffect(() => { load() }, [load])

  const dedupedReviews = useMemo(
    () => state.data ? dedupeReviews(state.data.reviews) : [],
    [state.data],
  )

  const rootComments = useMemo(
    () => state.data?.comments.filter((c) => c.inReplyToId === null) ?? [],
    [state.data],
  )

  const resolvedCount = useMemo(() => rootComments.filter((c) => c.isResolved).length, [rootComments])
  const unresolvedCount = rootComments.length - resolvedCount

  // Filter comments based on current filter mode.
  // Every comment (root + reply) has isResolved set from the GraphQL thread map,
  // so we can filter directly without chasing inReplyToId chains.
  const filteredComments = useMemo(() => {
    if (!state.data || state.filter === 'all') return state.data?.comments ?? []
    const matchResolved = state.filter === 'resolved'
    return state.data.comments.filter((c) => c.isResolved === matchResolved)
  }, [state.data, state.filter])

  const fileGroups = useMemo(
    () => groupCommentsByFile(filteredComments),
    [filteredComments],
  )

  const inlineCount = rootComments.length
  const commentedFileCount = useMemo(
    () => new Set(rootComments.map((c) => c.path)).size,
    [rootComments],
  )

  const handleOpenFile = useCallback((path: string) => {
    // File paths from GitHub are relative to repo root, which matches worktree
    const fullPath = worktreePath + '/' + path
    openFile(fullPath)
  }, [worktreePath, openFile])

  const handleStartReply = useCallback((commentId: number) => {
    setReplyingToId(commentId)
    setReplyError(null)
  }, [])

  const handleCancelReply = useCallback(() => {
    setReplyingToId(null)
    setReplyError(null)
  }, [])

  const handleDraftChange = useCallback((value: string) => {
    if (replyingToId === null) return
    setReplyDrafts((prev) => ({ ...prev, [replyingToId]: value }))
  }, [replyingToId])

  const handleSubmitReply = useCallback(async (commentId: number) => {
    const body = (replyDrafts[commentId] ?? '').trim()
    if (!body) return

    setSubmittingReplyId(commentId)
    setReplyError(null)
    try {
      await ipc.github.replyToReviewComment(worktreePath, commentId, body)
    } catch {
      setReplyError(t('center:codeReviewReplyFailed'))
      setSubmittingReplyId(null)
      return
    }

    setReplyingToId(null)
    setReplyDrafts((prev) => {
      const next = { ...prev }
      delete next[commentId]
      return next
    })
    setSubmittingReplyId(null)
    void load(true, false)
  }, [load, replyDrafts, t, worktreePath])

  const replyState = useMemo<ReplyState>(() => ({
    replyingToId,
    draft: replyingToId !== null ? replyDrafts[replyingToId] ?? '' : '',
    submittingId: submittingReplyId,
    error: replyError,
    onStart: handleStartReply,
    onCancel: handleCancelReply,
    onDraftChange: handleDraftChange,
    onSubmit: handleSubmitReply,
  }), [
    replyingToId,
    replyDrafts,
    submittingReplyId,
    replyError,
    handleStartReply,
    handleCancelReply,
    handleDraftChange,
    handleSubmitReply,
  ])

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
        <CodeReviewHeader t={t} />
        <EmptyState title={t('center:codeReviewEmpty')} hint={t('center:codeReviewEmptyHint')} />
      </div>
    )
  }

  if (dedupedReviews.length === 0 && inlineCount === 0) {
    return (
      <div className="code-review-view">
        <CodeReviewHeader t={t} />
        <EmptyState title={t('center:codeReviewEmpty')} hint={t('center:codeReviewEmptyHint')} />
      </div>
    )
  }

  return (
    <div className="code-review-view">
      <CodeReviewHeader
        t={t}
        summary={t('center:codeReviewSummary', { reviewCount: dedupedReviews.length, commentCount: inlineCount })}
      />

      <CodeReviewOverview
        reviewCount={dedupedReviews.length}
        unresolvedCount={unresolvedCount}
        resolvedCount={resolvedCount}
        fileCount={commentedFileCount}
        t={(key) => t(`center:${key}`)}
      />

      {/* Filter bar - only show when there are inline comments */}
      {inlineCount > 0 && (
        <div className="code-review-filter-bar">
          <button
            className={`code-review-filter-chip${state.filter === 'all' ? ' code-review-filter-chip--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_FILTER', filter: 'all' })}
          >
            {t('center:codeReviewFilterAll', { count: inlineCount })}
          </button>
          <button
            className={`code-review-filter-chip code-review-filter-chip--unresolved${state.filter === 'unresolved' ? ' code-review-filter-chip--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_FILTER', filter: 'unresolved' })}
          >
            {t('center:codeReviewFilterOpen', { count: unresolvedCount })}
          </button>
          <button
            className={`code-review-filter-chip code-review-filter-chip--resolved${state.filter === 'resolved' ? ' code-review-filter-chip--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_FILTER', filter: 'resolved' })}
          >
            {t('center:codeReviewFilterResolved', { count: resolvedCount })}
          </button>
        </div>
      )}

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
        {Array.from(fileGroups.entries()).map(([filePath, comments]) => {
          const openCount = getOpenCount(comments)
          return (
            <div key={filePath} className="code-review-file-group">
              <div className="code-review-file-header">
                <span className="code-review-file-icon"><IconFile size={14} /></span>
                <span className="code-review-file-path" onClick={() => handleOpenFile(filePath)}>
                  {filePath}
                </span>
                {openCount > 0 && (
                  <span className="code-review-file-open">
                    {t('center:codeReviewFilterOpen', { count: openCount })}
                  </span>
                )}
                <span className="code-review-file-count">
                  {t('right:reviewComments', { count: comments.length })}
                </span>
              </div>
              <div className="code-review-comments">
                {comments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    allComments={filteredComments}
                    isRoot
                    replyState={replyState}
                    t={(k, opts) => t(`center:${k}`, opts as Record<string, string>)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {/* Empty filter state */}
        {state.filter !== 'all' && fileGroups.size === 0 && inlineCount > 0 && (
          <EmptyState
            title={state.filter === 'resolved' ? t('center:codeReviewNoResolved') : t('center:codeReviewNoOpen')}
          />
        )}
      </div>
    </div>
  )
}

function CodeReviewOverview({
  reviewCount, unresolvedCount, resolvedCount, fileCount, t,
}: {
  reviewCount: number
  unresolvedCount: number
  resolvedCount: number
  fileCount: number
  t: (key: string) => string
}) {
  const items = [
    { label: t('codeReviewStatsReviews'), value: reviewCount, tone: 'neutral' },
    { label: t('codeReviewStatsOpen'), value: unresolvedCount, tone: 'open' },
    { label: t('codeReviewStatsResolved'), value: resolvedCount, tone: 'resolved' },
    { label: t('codeReviewStatsFiles'), value: fileCount, tone: 'neutral' },
  ]
  return (
    <div className="code-review-overview">
      {items.map((item) => (
        <div key={item.label} className={`code-review-overview-item code-review-overview-item--${item.tone}`}>
          <span className="code-review-overview-value">{item.value}</span>
          <span className="code-review-overview-label">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

function CodeReviewHeader({
  t, summary,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string
  summary?: string
}) {
  return (
    <div className="code-review-header">
      <span className="code-review-header-title">{t('center:codeReviewTitle')}</span>
      {summary && <span className="code-review-header-summary">{summary}</span>}
    </div>
  )
}
