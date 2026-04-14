import { useCallback, memo } from 'react'
import type { PrCardData } from '@/types'
import { useUIStore } from '@/store/ui'
import { useTranslation } from 'react-i18next'

interface Props {
  data: PrCardData
}

function checksIcon(status: string): string {
  switch (status) {
    case 'passing': return '\u2705'
    case 'failing': return '\u274C'
    case 'pending': return '\u23F3'
    default: return ''
  }
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

      <div className="mc-card-pr">
        <span>PR #{data.pr.number}</span>
        {data.checksStatus !== 'none' && (
          <span title={t(CHECKS_KEYS[data.checksStatus] ?? '')}>
            {checksIcon(data.checksStatus)}
          </span>
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
    </button>
  )
})
