import { useCallback, useEffect, useReducer, useRef, memo } from 'react'
import type { SessionCardData } from '@/types'
import { useUIStore } from '@/store/ui'
import { useSessionsStore } from '@/store/sessions'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui'
import { Tooltip } from '@/components/shared/Tooltip'
import { MODELS } from '@/components/Center/ModelSelector'
import { SessionHoverCard } from './SessionHoverCard'

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

function completedAgoKey(runCompletedAt: number): { key: string; count: number } {
  const mins = Math.floor((Date.now() - runCompletedAt) / 60_000)
  if (mins < 1) return { key: 'completedJustNow', count: 0 }
  if (mins < 60) return { key: 'completedMinsAgo', count: mins }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { key: 'completedHoursAgo', count: hours }
  return { key: 'completedDaysAgo', count: Math.floor(hours / 24) }
}

function formatTokenCount(n: number): string {
  if (n < 1000) return `${n}t`
  return `${(n / 1000).toFixed(1)}k`
}

function modelLabel(modelId: string): string {
  return MODELS.find((m) => m.id === modelId)?.label ?? modelId
}

function derivePendingReason(
  data: SessionCardData,
  t: (key: string, opts?: Record<string, string>) => string
): string | null {
  if (data.pendingAuthError) return data.pendingAuthError.message
  if (data.pendingToolPermission) {
    const name = data.pendingToolPermission.displayName ?? data.pendingToolPermission.toolName
    return t('pendingPermission', { tool: name })
  }
  if (data.pendingQuestion) {
    const first = data.pendingQuestion.questions[0]
    return first?.header ?? first?.question ?? null
  }
  if (data.pendingPlanApproval) return t('pendingPlanApproval')
  return null
}

const STATUS_KEYS: Record<string, string> = {
  running: 'statusRunning',
  waiting_input: 'statusWaiting',
  error: 'statusError',
  idle: 'statusIdle',
  inactive: 'statusInactive',
}

const HOVER_DELAY = 400

interface HoverState {
  visible: boolean
  anchorRect: DOMRect | null
}

type HoverAction = { type: 'SHOW'; rect: DOMRect } | { type: 'HIDE' }

function hoverReducer(state: HoverState, action: HoverAction): HoverState {
  switch (action.type) {
    case 'SHOW': return { visible: true, anchorRect: action.rect }
    case 'HIDE': return state.visible ? { visible: false, anchorRect: null } : state
  }
}

export const SessionCard = memo(function SessionCard({ data, onDismiss }: Props) {
  const { t } = useTranslation('missionControl')
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)
  const setActiveSession = useSessionsStore((s) => s.setActiveSession)

  // Live elapsed timer - only ticks while running
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!data.runStartedAt) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [data.runStartedAt])

  const elapsed = computeElapsed(data.runStartedAt)

  // Hover card state
  const [hover, hoverDispatch] = useReducer(hoverReducer, { visible: false, anchorRect: null })
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const showHover = useCallback(() => {
    clearHoverTimer()
    hoverTimerRef.current = setTimeout(() => {
      if (!cardRef.current) return
      hoverDispatch({ type: 'SHOW', rect: cardRef.current.getBoundingClientRect() })
    }, HOVER_DELAY)
  }, [clearHoverTimer])

  const hideHover = useCallback(() => {
    clearHoverTimer()
    hoverDispatch({ type: 'HIDE' })
  }, [clearHoverTimer])

  // Keep hover card visible when mouse moves from card to hover card
  const cancelHide = useCallback(() => {
    clearHoverTimer()
  }, [clearHoverTimer])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  const handleClick = useCallback(() => {
    hideHover()
    selectWorktree(data.projectId, data.worktreeId)
    setActiveSession(data.sessionId)
    setActiveCenterView({ type: 'session', sessionId: data.sessionId })
    setMissionControlActive(false)
  }, [data.projectId, data.worktreeId, data.sessionId, selectWorktree, setActiveSession, setActiveCenterView, setMissionControlActive, hideHover])

  const statusClass =
    data.status === 'running' ? ' mc-card--running' :
    data.status === 'waiting_input' ? ' mc-card--waiting' :
    data.status === 'error' ? ' mc-card--error' : ''

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDismiss?.()
  }, [onDismiss])

  const pendingReason = derivePendingReason(data, t)
  const totalTokens = data.tokenUsage ? data.tokenUsage.input + data.tokenUsage.output : 0

  return (
    <div
      ref={cardRef}
      className={`mc-card mc-session-card${statusClass}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      onMouseEnter={showHover}
      onMouseLeave={hideHover}
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
        <Badge variant="muted" size="sm">{modelLabel(data.model)}</Badge>
      </div>

      <div className="mc-card-activity-row">
        {pendingReason ? (
          <span className="mc-card-pending" title={pendingReason}>{pendingReason}</span>
        ) : (
          <span className="mc-card-activity">
            {data.activity || t(STATUS_KEYS[data.status] ?? 'statusInactive')}
          </span>
        )}
      </div>

      {(data.column === 'done' || totalTokens > 0) && (
        <div className="mc-card-footer">
          {data.column === 'done' && data.runCompletedAt && (
            <span className="mc-card-completed-ago">
              {(() => {
                const { key, count } = completedAgoKey(data.runCompletedAt)
                return t(key, { count })
              })()}
            </span>
          )}
          {totalTokens > 0 && (
            <Tooltip
              content={t('tokenBreakdown', {
                input: data.tokenUsage!.input.toLocaleString(),
                output: data.tokenUsage!.output.toLocaleString(),
              })}
              position="bottom"
            >
              <span className="mc-card-tokens">{formatTokenCount(totalTokens)}</span>
            </Tooltip>
          )}
        </div>
      )}

      {hover.visible && hover.anchorRect && (
        <SessionHoverCard
          data={data}
          anchorRect={hover.anchorRect}
          onMouseEnter={cancelHide}
          onMouseLeave={hideHover}
        />
      )}
    </div>
  )
})
