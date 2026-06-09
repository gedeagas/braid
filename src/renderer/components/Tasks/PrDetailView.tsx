import { Badge, Button, Spinner } from '@/components/ui'
import { Trans, useTranslation } from 'react-i18next'
import {
  IconArrowLeft,
  IconCheckCircle,
  IconClose,
  IconFile,
  IconGitBranch,
  IconGitHub,
  IconMergeGraph,
  IconMessageBubble,
  IconRefresh,
  IconXCircleStatus,
} from '@/components/shared/icons'
import { formatRelativeTime } from '@/lib/relativeTime'
import * as ipc from '@/lib/ipc'
import type { TaskRow } from './types'
import type { PrDetailController } from './usePrDetailController'
import { TaskMarkdown } from './TaskMarkdown'
import { PrConversationTab } from './PrConversationTab'
import { PrFilesTab } from './PrFilesTab'
import { PrDetailSidebar } from './PrDetailSidebar'
import { formatState, mergeVariant, reviewVariant, stateLabel, stateVariant } from './taskUtils'

interface PrDetailViewProps {
  selectedRow: TaskRow
  setSelectedRow: (row: TaskRow | null) => void
  detail: PrDetailController
}

export function PrDetailView({ selectedRow, setSelectedRow, detail }: PrDetailViewProps) {
  const { t } = useTranslation('tasks')
  const { review, prDetail, prDetailLoading, prDetailError, detailItem, detailMarkdownBaseUrl, actions } = detail
  if (!detailItem) return null
  const backToWorktree = selectedRow.detailBackTarget === 'worktree' && Boolean(selectedRow.matchingWorktreeId)
  const handleBack = () => {
    setSelectedRow(null)
    if (backToWorktree) {
      actions.handleOpenMatchingWorktree()
    }
  }

  return (
    <div className="pull-requests-body task-detail-body">
      <div className="task-detail-toolbar">
        <button className="task-detail-back" onClick={handleBack}>
          <IconArrowLeft size={12} />
          <span>{backToWorktree ? t('detail.backToWorkspace') : t('detail.backToPullRequests')}</span>
        </button>
        <div className="task-detail-actions">
          {selectedRow.matchingWorktreeId && (
            <Button variant="primary" size="sm" className="task-detail-workspace-action" onClick={actions.handleOpenMatchingWorktree}>
              <IconGitBranch size={13} />
              {t('detail.openWorkspace')}
            </Button>
          )}
          {!selectedRow.matchingWorktreeId && selectedRow.item.type === 'pr' && selectedRow.item.headBranch && (
            <Button
              variant="primary"
              size="sm"
              className="task-detail-workspace-action"
              onClick={() => actions.handleCreateWorktreeForRow(selectedRow)}
              loading={review.creatingWorktreeForRowId === `${selectedRow.projectId}:${selectedRow.item.id}`}
              disabled={review.creatingWorktreeForRowId !== null}
            >
              <IconGitBranch size={13} />
              {t('detail.startWorkspaceFromPr')}
            </Button>
          )}
          {detailItem.url && <Button size="sm" onClick={() => ipc.shell.openExternal(detailItem.url)}><IconGitHub size={13} />{t('github')}</Button>}
          <DetailRefreshStatus detail={detail} />
          <Button size="icon-sm" onClick={actions.handleRefreshPrDetail} aria-label={t('detail.refreshPullRequest')} loading={prDetailLoading}>
            {!prDetailLoading && <IconRefresh size={14} />}
          </Button>
        </div>
      </div>
      {review.prActionError && (
        <div className="task-detail-action-error">
          <span>{review.prActionError}</span>
          <button onClick={() => review.setPrActionError(null)} aria-label={t('detail.dismissActionError')}><IconClose size={8} /></button>
        </div>
      )}

      <div className="task-detail-scroll">
        <DetailHero selectedRow={selectedRow} detail={detail} />
        {prDetailLoading && !prDetail && <DetailSkeleton />}
        {prDetailError && <div className="task-detail-error"><span>{prDetailError}</span><Button size="sm" onClick={actions.handleRefreshPrDetail}>{t('detail.retry')}</Button></div>}
        {prDetail && (
          <div className={review.detailTab === 'files' ? 'task-detail-layout task-detail-layout--wide' : 'task-detail-layout'}>
            <main className="task-detail-main">
              <DetailTabs detail={detail} />
              {review.detailTab === 'description' && <DescriptionTab detail={detail} />}
              {review.detailTab === 'files' && <PrFilesTab detail={detail} />}
            </main>
            {review.detailTab === 'description' && <PrDetailSidebar detail={detail} />}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRefreshStatus({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { prDetail, prSummaryRefreshStatus, prSummaryRefreshedAt } = detail
  if (!prDetail) return null

  const title = prSummaryRefreshStatus === 'refreshing'
    ? t('detail.refreshingSummary')
    : prSummaryRefreshStatus === 'error'
      ? t('detail.summaryRefreshFailed')
      : prSummaryRefreshedAt
        ? t('detail.summaryUpdatedTime', { time: formatRelativeTime(prSummaryRefreshedAt) })
        : t('detail.summaryAutoRefresh')
  const text = prSummaryRefreshStatus === 'refreshing'
    ? t('detail.refreshingSummary')
    : prSummaryRefreshStatus === 'error'
      ? t('detail.summaryRefreshFailedShort')
      : prSummaryRefreshedAt
        ? t('detail.summaryUpdatedTime', { time: formatRelativeTime(prSummaryRefreshedAt) })
        : t('detail.summaryAutoRefresh')

  return (
    <span className={`task-detail-refresh-status task-detail-refresh-status--${prSummaryRefreshStatus}`} title={title} aria-label={title}>
      {prSummaryRefreshStatus === 'refreshing' ? <Spinner size="sm" /> : <span className="task-detail-refresh-status-dot" aria-hidden="true" />}
      <span>{text}</span>
    </span>
  )
}

function DetailHero({ selectedRow, detail }: { selectedRow: TaskRow; detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { prDetail, detailItem } = detail
  if (!detailItem) return null
  const showMergeState = detailItem.state === 'open' && Boolean(detailItem.mergeStateStatus)
  const headBranch = detailItem.headBranch ?? t('unknown')
  const baseBranch = detailItem.baseBranch ?? t('base')
  const mergeIntentKey = detailItem.state === 'merged'
    ? 'detail.mergeIntentMerged'
    : detailItem.state === 'closed'
      ? 'detail.mergeIntentClosed'
      : 'detail.mergeIntentOpen'
  const stateIcon = detailItem.state === 'merged'
    ? <IconMergeGraph size={13} />
    : detailItem.state === 'open'
      ? <IconCheckCircle size={12} />
      : <IconXCircleStatus size={12} />
  return (
    <section className="task-detail-hero">
      <div className="task-detail-hero-main">
        <div className="task-detail-kicker">
          <span>{prDetail?.item.repoNameWithOwner ?? selectedRow.projectName}</span>
          <span>{t('detail.prNumber', { number: detailItem.number })}</span>
          <span>{t('detail.branchComparison', { head: headBranch, base: baseBranch })}</span>
        </div>
        <h1>{detailItem.title}</h1>
        <div className="task-detail-meta">
          <div className="task-detail-merge-row">
            <Badge variant={stateVariant(detailItem)} size="sm" className="task-detail-status-badge">
              {stateIcon}
              {stateLabel(detailItem, t)}
            </Badge>
            <span className="task-detail-merge-copy">
              <Trans
                i18nKey={mergeIntentKey}
                ns="tasks"
                values={{ author: detailItem.author || t('unknown'), base: baseBranch, head: headBranch }}
                components={{
                  author: <strong className="task-detail-author" />,
                  targetBranch: <span className="task-detail-branch-pill" />,
                  sourceBranch: <span className="task-detail-branch-pill task-detail-branch-pill--head" />,
                }}
              />
            </span>
            <span className="task-detail-byline-separator" aria-hidden="true">·</span>
            <span className="task-detail-updated-time">{t('detail.updatedTime', { time: detailItem.updatedAt ? formatRelativeTime(detailItem.updatedAt) : '-' })}</span>
          </div>
          {(showMergeState || detailItem.reviewDecision) && (
            <div className="task-detail-status-row task-detail-status-row--secondary">
              {showMergeState && <Badge variant={mergeVariant(detailItem.mergeStateStatus)} size="sm" className="task-detail-status-badge">{formatState(detailItem.mergeStateStatus, t)}</Badge>}
              {detailItem.reviewDecision && <Badge variant={reviewVariant(detailItem.reviewDecision)} size="sm" className="task-detail-status-badge">{formatState(detailItem.reviewDecision, t)}</Badge>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function DetailTabs({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { review, prDetail, activityCounts } = detail
  if (!prDetail) return null
  return (
    <div className="task-detail-tabs" role="tablist" aria-label={t('detail.pullRequestDetail')}>
      <button className={review.detailTab === 'description' ? 'active' : ''} onClick={() => review.setDetailTab('description')} role="tab" aria-selected={review.detailTab === 'description'}>
        <IconMessageBubble size={13} />
        <span>{t('detail.description')}</span>
        <em>{activityCounts.all}</em>
      </button>
      <button className={review.detailTab === 'files' ? 'active' : ''} onClick={() => review.setDetailTab('files')} role="tab" aria-selected={review.detailTab === 'files'}>
        <IconFile size={13} />
        <span>{t('detail.filesChanged')}</span>
        <em>{prDetail.files.length}</em>
      </button>
    </div>
  )
}

function DescriptionTab({ detail }: { detail: PrDetailController }) {
  const { t } = useTranslation('tasks')
  const { prDetail, detailMarkdownBaseUrl } = detail
  if (!prDetail) return null
  return (
    <>
      <section className="task-detail-panel">
        <div className="task-detail-panel-header">
          <IconMessageBubble size={14} />
          <h2>{t('detail.description')}</h2>
        </div>
        <div className="task-detail-description">
          {prDetail.item.body.trim() ? <TaskMarkdown body={prDetail.item.body} baseUrl={detailMarkdownBaseUrl} /> : <span className="task-detail-muted">{t('detail.noDescription')}</span>}
        </div>
      </section>
      <PrConversationTab detail={detail} />
    </>
  )
}

function DetailSkeleton() {
  return (
    <div className="task-detail-loading task-detail-loading--full">
      <div className="task-detail-loading-main">
        <div className="task-detail-loading-panel">
          <span className="pr-skeleton pr-skeleton--title" />
          <span className="pr-skeleton pr-skeleton--context" />
          <span className="pr-skeleton pr-skeleton--context" />
          <span className="pr-skeleton pr-skeleton--body" />
        </div>
        <div className="task-detail-loading-panel">
          <span className="pr-skeleton pr-skeleton--title" />
          <span className="pr-skeleton pr-skeleton--context" />
          <span className="pr-skeleton pr-skeleton--context" />
          <span className="pr-skeleton pr-skeleton--context" />
        </div>
      </div>
      <div className="task-detail-loading-side">
        <span className="pr-skeleton pr-skeleton--badge" />
        <span className="pr-skeleton pr-skeleton--merge" />
        <span className="pr-skeleton pr-skeleton--merge" />
      </div>
    </div>
  )
}
