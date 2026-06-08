import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button } from '@/components/ui'
import { IconExternalLinkSmall, IconFile, IconMessageBubble } from '@/components/shared/icons'
import { formatRelativeTime } from '@/lib/relativeTime'
import * as ipc from '@/lib/ipc'
import { ACTIVITY_FILTERS } from './constants'
import { TaskAvatar, TaskMarkdown } from './TaskMarkdown'
import { TaskReactions } from './TaskReactions'
import type { PrDetailController } from './usePrDetailController'
import { formatState, reviewVariant } from './taskUtils'

type ReviewComment = PrDetailController['rootReviewComments'][number]

export function PrConversationTab({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { review, prDetail, timelineEntries, reviewRepliesByParent, activityCounts, detailMarkdownBaseUrl, actions } = detail
  if (!prDetail) return null

  return (
    <section className="task-detail-panel">
      <div className="task-detail-panel-header">
        <IconMessageBubble size={14} />
        <h2>{t('conversation.comments')}</h2>
        <span>{t('conversation.commentCount', { count: activityCounts.all })}</span>
      </div>
      <div className="task-comments-toolbar">
        <div className="task-activity-filters" role="tablist" aria-label={t('conversation.filtersAria')}>
          {ACTIVITY_FILTERS.map((filter) => (
            <button key={filter.id} className={review.activityFilter === filter.id ? 'active' : ''} onClick={() => review.setActivityFilter(filter.id)} role="tab" aria-selected={review.activityFilter === filter.id}>
              <span>{t(filter.labelKey)}</span>
              <em>{activityCounts[filter.id]}</em>
            </button>
          ))}
        </div>
      </div>
      <div className="task-detail-composer task-detail-composer--top">
        <textarea value={review.prCommentBody} onChange={(event) => review.setPrCommentBody(event.target.value)} placeholder={t('conversation.addCommentPlaceholder')} rows={3} />
        <div className="task-detail-composer-actions">
          {review.commentError && <span>{review.commentError}</span>}
          <Button size="sm" onClick={actions.handleSubmitPrComment} loading={review.postingPrComment} disabled={!review.prCommentBody.trim()}>
            {t('conversation.comment')}
          </Button>
        </div>
      </div>
      <div className="task-detail-timeline">
        {timelineEntries.length === 0 ? (
          <div className="task-detail-empty">{t('conversation.noActivity')}</div>
        ) : timelineEntries.map((entry) => {
          if (entry.kind === 'issue-comment') return <IssueCommentEntry key={`issue-comment:${entry.item.id}`} detail={detail} comment={entry.item} />
          if (entry.kind === 'review') return <ReviewEntry key={`review:${entry.item.id}`} review={entry.item} baseUrl={detailMarkdownBaseUrl} />
          return (
            <ReviewCommentEntry
              key={`comment:${entry.item.id}`}
              detail={detail}
              comment={entry.item}
              replies={reviewRepliesByParent.get(entry.item.id) ?? []}
            />
          )
        })}
      </div>
    </section>
  )
}

function IssueCommentEntry({ detail, comment }: { detail: PrDetailController; comment: PrDetailController['issueComments'][number] }) {
  const { t } = useTranslation('tasks')
  return (
    <div className={['task-detail-timeline-item', 'task-detail-conversation-comment', comment.pending ? 'task-detail-timeline-item--pending' : null, comment.error ? 'task-detail-timeline-item--error' : null].filter(Boolean).join(' ')}>
      <TaskAvatar author={comment.author} avatarUrl={comment.authorAvatarUrl} />
      <div className="task-activity-content">
        <div className="task-detail-activity-header">
          <strong>{comment.author || t('unknown')}</strong>
          <em>{comment.pending ? t('conversation.sending') : comment.createdAt ? formatRelativeTime(comment.createdAt) : ''}</em>
          {comment.error && <Badge variant="danger" size="sm">{t('conversation.failed')}</Badge>}
          {comment.htmlUrl && <button onClick={() => ipc.shell.openExternal(comment.htmlUrl)} aria-label={t('conversation.openCommentOnGitHub')}><IconExternalLinkSmall size={9} /></button>}
        </div>
        <TaskMarkdown body={comment.body} baseUrl={detail.detailMarkdownBaseUrl} />
        <TaskReactions comment={comment} reactingSubjectIds={detail.review.reactingSubjectIds} onToggleReaction={detail.actions.handleToggleReaction} />
        {comment.error && <div className="task-activity-error">{comment.error}</div>}
      </div>
    </div>
  )
}

function ReviewEntry({ review, baseUrl }: { review: NonNullable<PrDetailController['prDetail']>['reviews'][number]; baseUrl?: string }) {
  const { t } = useTranslation('tasks')
  const actionText = getReviewActionText(review.state, t)
  return (
    <button className="task-detail-timeline-item task-detail-review" onClick={() => review.htmlUrl && ipc.shell.openExternal(review.htmlUrl)}>
      <TaskAvatar author={review.author} avatarUrl={review.authorAvatarUrl} />
      <div className="task-activity-content">
        <div className="task-detail-activity-header">
          <strong>{review.author || t('unknown')}</strong>
          <span>{actionText}</span>
          <Badge variant={reviewVariant(review.state)} size="sm">{formatState(review.state, t)}</Badge>
          <em>{review.submittedAt ? formatRelativeTime(review.submittedAt) : ''}</em>
        </div>
        {review.body.trim() && <TaskMarkdown body={review.body} baseUrl={baseUrl} />}
      </div>
    </button>
  )
}

function getReviewActionText(state: string, t: ReturnType<typeof useTranslation>['t']): string {
  if (state === 'APPROVED') return t('conversation.reviewApproved')
  if (state === 'CHANGES_REQUESTED') return t('conversation.reviewChangesRequested')
  if (state === 'COMMENTED') return t('conversation.reviewCommented')
  if (state === 'DISMISSED') return t('conversation.reviewDismissed')
  return t('conversation.reviewSubmitted')
}

export function ReviewCommentEntry({ detail, comment, replies, compact = false }: {
  detail: PrDetailController
  comment: ReviewComment
  replies: PrDetailController['rootReviewComments']
  compact?: boolean
}) {
  const { t } = useTranslation('tasks')
  const { review, actions, detailMarkdownBaseUrl } = detail
  const body = (
    <>
      <ReviewCommentHeader detail={detail} comment={comment} />
      {!compact && (
        <div className="task-review-context">
          <strong>{comment.author || t('unknown')}</strong>
          <span>{comment.path}</span>
        </div>
      )}
      {!compact && comment.diffHunk && (
        <div className="task-review-diff-wrap">
          <button className="task-review-diff-toggle" onClick={() => review.toggleDiffExpansion(comment.id)}>
            <IconFile size={11} />
            <span>{review.expandedDiffCommentIds.has(comment.id) ? t('conversation.hideContext') : t('conversation.showContext')}</span>
            <em>{t('conversation.lineCount', { count: comment.diffHunk.split('\n').length })}</em>
          </button>
          {review.expandedDiffCommentIds.has(comment.id) && <pre className="task-review-diff"><code>{comment.diffHunk}</code></pre>}
        </div>
      )}
      <TaskMarkdown body={comment.body} baseUrl={detailMarkdownBaseUrl} />
      <TaskReactions comment={comment} reactingSubjectIds={review.reactingSubjectIds} onToggleReaction={actions.handleToggleReaction} />
    </>
  )

  if (compact) {
    return (
      <div className="task-inline-comment-thread">
        <div className="task-inline-comment">
          <TaskAvatar author={comment.author} avatarUrl={comment.authorAvatarUrl} />
          <div className="task-activity-content">{body}</div>
        </div>
        {replies.map((reply) => <ReplyEntry key={`reply:${reply.id}`} detail={detail} reply={reply} />)}
        <ReviewThreadReply detail={detail} comment={comment} />
      </div>
    )
  }

  return (
    <div className="task-detail-timeline-item task-detail-comment">
      <TaskAvatar author={comment.author} avatarUrl={comment.authorAvatarUrl} />
      <div className="task-activity-content">
        {body}
        {replies.map((reply) => <ReplyEntry key={`reply:${reply.id}`} detail={detail} reply={reply} />)}
        <ReviewThreadReply detail={detail} comment={comment} />
      </div>
    </div>
  )
}

function ReviewCommentHeader({ detail, comment }: { detail: PrDetailController; comment: ReviewComment }) {
  const { t } = useTranslation('tasks')
  const { review, actions } = detail
  return (
    <div className="task-detail-activity-header">
      <IconFile size={12} />
      <span>{comment.path}{comment.startLine && comment.line && comment.startLine !== comment.line ? `:${comment.startLine}-${comment.line}` : comment.line ? `:${comment.line}` : ''}</span>
      <Badge variant={comment.isResolved ? 'success' : 'warning'} size="sm">{comment.isResolved ? t('conversation.resolved') : t('conversation.open')}</Badge>
      {comment.isOutdated && <Badge variant="muted" size="sm">{t('conversation.outdated')}</Badge>}
      <em>{comment.createdAt ? formatRelativeTime(comment.createdAt) : ''}</em>
      {comment.threadId && <button onClick={() => actions.handleResolveThread(comment, !comment.isResolved)} disabled={review.resolvingThreadIds.has(comment.threadId)}>{comment.isResolved ? t('conversation.reopen') : t('conversation.resolve')}</button>}
      {comment.htmlUrl && <button onClick={() => ipc.shell.openExternal(comment.htmlUrl)} aria-label={t('conversation.openCommentOnGitHub')}><IconExternalLinkSmall size={9} /></button>}
    </div>
  )
}

function ReplyEntry({ detail, reply }: { detail: PrDetailController; reply: ReviewComment }) {
  const { t } = useTranslation('tasks')
  return (
    <div className={['task-detail-comment-reply', reply.pending ? 'task-detail-comment-reply--pending' : null, reply.error ? 'task-detail-comment-reply--error' : null].filter(Boolean).join(' ')}>
      <TaskAvatar author={reply.author} avatarUrl={reply.authorAvatarUrl} />
      <div className="task-activity-content">
        <div className="task-detail-activity-header">
          <strong>{reply.author || t('unknown')}</strong>
          <em>{reply.pending ? t('conversation.sending') : reply.createdAt ? formatRelativeTime(reply.createdAt) : ''}</em>
          {reply.error && <Badge variant="danger" size="sm">{t('conversation.failed')}</Badge>}
          {reply.htmlUrl && <button onClick={() => ipc.shell.openExternal(reply.htmlUrl)} aria-label={t('conversation.openReplyOnGitHub')}><IconExternalLinkSmall size={9} /></button>}
        </div>
        <TaskMarkdown body={reply.body} baseUrl={detail.detailMarkdownBaseUrl} />
        <TaskReactions comment={reply} reactingSubjectIds={detail.review.reactingSubjectIds} onToggleReaction={detail.actions.handleToggleReaction} />
        {reply.error && <div className="task-activity-error">{reply.error}</div>}
      </div>
    </div>
  )
}

function ReviewThreadReply({ detail, comment }: { detail: PrDetailController; comment: ReviewComment }) {
  const { t } = useTranslation('tasks')
  const { review } = detail
  const isReplying = review.replyingCommentId === comment.id
  const startReply = () => {
    review.setReplyingCommentId(comment.id)
    review.setReplyBody('')
    review.setCommentError(null)
  }

  return (
    <div className={['task-thread-reply', isReplying ? 'task-thread-reply--active' : null].filter(Boolean).join(' ')}>
      {isReplying ? (
        <ReplyComposer detail={detail} comment={comment} />
      ) : (
        <button className="task-thread-reply-prompt" onClick={startReply} type="button">
          <span>{t('conversation.replyPrompt')}</span>
        </button>
      )}
    </div>
  )
}

function ReplyComposer({ detail, comment }: { detail: PrDetailController; comment: ReviewComment }) {
  const { t } = useTranslation('tasks')
  const { review, actions } = detail
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const cancelReply = () => {
    review.setReplyingCommentId(null)
    review.setReplyBody('')
    review.setCommentError(null)
  }

  return (
    <div className="task-detail-reply-composer">
      <textarea ref={textareaRef} value={review.replyBody} onChange={(event) => review.setReplyBody(event.target.value)} placeholder={t('conversation.replyPlaceholder')} rows={3} />
      <div className="task-detail-composer-actions">
        {review.commentError && <span>{review.commentError}</span>}
        <Button size="sm" onClick={cancelReply} disabled={review.postingReplyId === comment.id}>
          {t('conversation.cancel')}
        </Button>
        <Button size="sm" onClick={() => actions.handleSubmitReviewReply(comment)} loading={review.postingReplyId === comment.id} disabled={!review.replyBody.trim()}>
          {t('conversation.reply')}
        </Button>
      </div>
    </div>
  )
}
