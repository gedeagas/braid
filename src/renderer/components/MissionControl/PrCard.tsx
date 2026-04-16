import { useCallback, memo } from 'react'
import type { PrCardData } from '@/types'
import { useUIStore } from '@/store/ui'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconCheckCircle, IconXCircleStatus, IconSpinner, IconExternalLinkSmall } from '@/components/shared/icons'
import * as ipc from '@/lib/ipc'

interface Props {
  data: PrCardData
}

const CHECKS_KEYS: Record<string, string> = {
  passing: 'checksPass',
  failing: 'checksFail',
  pending: 'checksPending',
}

export const PrCard = memo(function PrCard({ data }: Props) {
  const { t } = useTranslation('missionControl')
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)

  const handleClick = useCallback(() => {
    selectWorktree(data.projectId, data.worktreeId)
    setMissionControlActive(false)
  }, [data.projectId, data.worktreeId, selectWorktree, setMissionControlActive])

  const handleOpenGitHub = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (data.pr.url) ipc.shell.openExternal(data.pr.url)
  }, [data.pr.url])

  return (
    <button className={`mc-card mc-pr-card${data.pr.state === 'MERGED' || data.pr.state === 'CLOSED' ? ' mc-pr-card--merged' : ''}`} onClick={handleClick}>
      <div className="mc-card-header">
        <span className="mc-card-branch" title={data.branch}>
          {data.branch}
        </span>
        <div className="mc-card-header-meta">
          <span className="mc-card-project">{data.projectName}</span>
          {data.isMain && <span className="mc-card-main">main</span>}
        </div>
      </div>

      <div className="mc-card-pr-title" title={data.pr.title}>
        {data.pr.title}
      </div>

      <div className="mc-card-pr">
        <span>PR #{data.pr.number}</span>
        {data.checksStatus !== 'none' && (
          <Tooltip content={t(CHECKS_KEYS[data.checksStatus] ?? '')} position="top">
            <span className="mc-card-checks-icon">
              {data.checksStatus === 'passing' && <IconCheckCircle size={13} />}
              {data.checksStatus === 'failing' && <IconXCircleStatus size={13} />}
              {data.checksStatus === 'pending' && <IconSpinner size={13} />}
            </span>
          </Tooltip>
        )}
        {data.pr.url && (
          <Tooltip content={t('openInGitHub')} position="top">
            <span
              className="mc-card-github-link"
              role="button"
              tabIndex={-1}
              onClick={handleOpenGitHub}
              aria-label={t('openInGitHub')}
            >
              <IconExternalLinkSmall size={10} />
            </span>
          </Tooltip>
        )}
      </div>

      {data.changeStats && data.changeStats.total > 0 && (
        <div className="mc-card-stats">
          <span className="additions">+{data.changeStats.additions}</span>
          {' '}
          <span className="deletions">-{data.changeStats.deletions}</span>
          {' '}
          <span className="mc-card-stats-label">
            {t('fileCount', { count: data.changeStats.total })}
          </span>
        </div>
      )}

      <PrBadges data={data} t={t} />
    </button>
  )
})

function PrBadges({ data, t }: { data: PrCardData; t: (key: string) => string }) {
  const { reviewDecision, mergeStateStatus, isDraft } = data.pr
  const knownReview = reviewDecision === 'APPROVED' || reviewDecision === 'CHANGES_REQUESTED' || reviewDecision === 'REVIEW_REQUIRED'
  const knownMerge = mergeStateStatus === 'BEHIND' || mergeStateStatus === 'DIRTY' || mergeStateStatus === 'BLOCKED'
  const hasBadges = knownReview || knownMerge || isDraft

  if (!hasBadges) return null

  return (
    <div className="mc-card-pr-badges">
      {reviewDecision === 'APPROVED' && <Badge variant="success" size="sm">{t('reviewApproved')}</Badge>}
      {reviewDecision === 'CHANGES_REQUESTED' && <Badge variant="danger" size="sm">{t('reviewChangesRequested')}</Badge>}
      {reviewDecision === 'REVIEW_REQUIRED' && <Badge variant="warning" size="sm">{t('reviewRequired')}</Badge>}
      {mergeStateStatus === 'BEHIND' && <Badge variant="warning" size="sm">{t('mergeBehind')}</Badge>}
      {mergeStateStatus === 'DIRTY' && <Badge variant="warning" size="sm">{t('mergeConflicts')}</Badge>}
      {mergeStateStatus === 'BLOCKED' && <Badge variant="danger" size="sm">{t('mergeBlocked')}</Badge>}
      {isDraft && <Badge variant="muted" size="sm">{t('prDraft')}</Badge>}
    </div>
  )
}
