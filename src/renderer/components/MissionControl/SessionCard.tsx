import { useCallback, useEffect, useReducer, memo } from 'react'
import type { SessionCardData } from '@/types'
import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'
import { useTranslation } from 'react-i18next'

interface Props {
  data: SessionCardData
  onDismiss?: () => void
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function computeElapsed(runStartedAt: number | null): number {
  if (!runStartedAt) return 0
  return Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000))
}

const STATUS_KEYS: Record<string, string> = {
  running: 'statusRunning',
  waiting_input: 'statusWaiting',
  error: 'statusError',
  idle: 'statusIdle',
  inactive: 'statusInactive',
}

export const SessionCard = memo(function SessionCard({ data, onDismiss }: Props) {
  const { t } = useTranslation('missionControl')
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)
  const setActiveSession = useSessionsStore((s) => s.setActiveSession)

  // Live elapsed timer — only ticks while running
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!data.runStartedAt) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [data.runStartedAt])

  const elapsed = computeElapsed(data.runStartedAt)

  const handleClick = useCallback(() => {
    selectWorktree(data.projectId, data.worktreeId)
    setActiveSession(data.sessionId)
    setActiveCenterView({ type: 'session', sessionId: data.sessionId })
    setMissionControlActive(false)
  }, [data.projectId, data.worktreeId, data.sessionId, selectWorktree, setActiveSession, setActiveCenterView, setMissionControlActive])

  const statusClass =
    data.status === 'running' ? ' mc-card--running' :
    data.status === 'waiting_input' ? ' mc-card--waiting' :
    data.status === 'error' ? ' mc-card--error' : ''

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDismiss?.()
  }, [onDismiss])

  return (
    <div
      className={`mc-card mc-session-card${statusClass}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
    >
      {onDismiss && (
        <button
          className="mc-card-dismiss"
          onClick={handleDismiss}
          title={t('dismissSession')}
        >
          ✓
        </button>
      )}
      <div className="mc-card-header">
        <span className="mc-card-branch" title={data.branch}>
          {data.branch}
        </span>
        <div className="mc-card-header-meta">
          <span className="mc-card-project">{data.projectName}</span>
        </div>
      </div>

      <div className="mc-card-status">
        <span className={`status-dot ${data.status}`} />
        <span className="mc-session-name" title={data.sessionName}>{data.sessionName}</span>
        {elapsed > 0 && (
          <span className="mc-card-elapsed">{formatElapsed(elapsed)}</span>
        )}
      </div>
      <div className="mc-card-activity-row">
        <span className="mc-card-activity">
          {data.activity || t(STATUS_KEYS[data.status] ?? 'statusInactive')}
        </span>
      </div>
    </div>
  )
})
