import { useTranslation } from 'react-i18next'
import { IconCheckCircle, IconClose, IconMessageBubble } from '@/components/shared/icons'
import type { TaskReviewSubmitAction } from '@/store/tasks'
import type { PrDetailController } from './usePrDetailController'

export function PrReviewSubmitForm({ detail, className = 'task-review-submit' }: { detail: PrDetailController; className?: string }) {
  const { t } = useTranslation('tasks')
  const { review, actions } = detail
  const body = review.reviewSubmitBody.trim()
  const busy = review.reviewSubmitBusy
  const canSubmitSummary = body.length > 0 && busy === null
  const canApprove = busy === null

  const submit = (event: TaskReviewSubmitAction) => {
    actions.handleSubmitPrReview(event)
  }

  return (
    <div className={className}>
      <textarea
        value={review.reviewSubmitBody}
        onChange={(event) => review.setReviewSubmitBody(event.target.value)}
        placeholder={t('review.summaryPlaceholder')}
        rows={3}
        disabled={busy !== null}
      />
      {review.reviewSubmitError && <div className="task-review-submit-error">{review.reviewSubmitError}</div>}
      <div className="task-review-submit-actions">
        <button type="button" onClick={() => submit('COMMENT')} disabled={!canSubmitSummary}>
          {busy === 'COMMENT' ? <span className="task-reviewer-saving-dot" /> : <IconMessageBubble size={13} />}
          {t('review.comment')}
        </button>
        <button type="button" className="task-review-submit-approve" onClick={() => submit('APPROVE')} disabled={!canApprove}>
          {busy === 'APPROVE' ? <span className="task-reviewer-saving-dot" /> : <IconCheckCircle size={13} />}
          {t('review.approve')}
        </button>
        <button type="button" className="task-review-submit-request" onClick={() => submit('REQUEST_CHANGES')} disabled={!canSubmitSummary}>
          {busy === 'REQUEST_CHANGES' ? <span className="task-reviewer-saving-dot" /> : <IconClose size={12} />}
          {t('review.requestChanges')}
        </button>
      </div>
    </div>
  )
}
