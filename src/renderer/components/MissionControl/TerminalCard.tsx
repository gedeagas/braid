import { useCallback, useEffect, useReducer, memo } from 'react'
import type { TerminalCardData } from '@/types'
import { useUIStore } from '@/store/ui'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui'
import { IconTerminal } from '@/components/shared/icons'
import { AgentIcon } from '@/components/shared/icons/AgentIcons'

interface Props {
  data: TerminalCardData
  onDismiss?: () => void
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function completedAgoKey(updatedAt: number): { key: string; count: number } {
  const mins = Math.floor((Date.now() - updatedAt) / 60_000)
  if (mins < 1) return { key: 'completedJustNow', count: 0 }
  if (mins < 60) return { key: 'completedMinsAgo', count: mins }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { key: 'completedHoursAgo', count: hours }
  return { key: 'completedDaysAgo', count: Math.floor(hours / 24) }
}

function agentTypeLabel(agentType: string | null): string | null {
  if (!agentType || agentType === 'unknown') return null
  return agentType.charAt(0).toUpperCase() + agentType.slice(1)
}

// Map agent state to the same CSS modifiers as session cards
const STATE_CLASS: Record<string, string> = {
  working: ' mc-card--running',
  blocked: ' mc-card--error',
  waiting: ' mc-card--waiting',
  done: '',
}

const STATE_KEYS: Record<string, string> = {
  working: 'terminalWorking',
  blocked: 'terminalBlocked',
  waiting: 'terminalWaiting',
  done: 'terminalDone',
}

// ── Component ────────────────────────────────────────────────────────────────

export const TerminalCard = memo(function TerminalCard({ data, onDismiss }: Props) {
  const { t } = useTranslation('missionControl')
  const selectWorktree = useUIStore((s) => s.selectWorktree)
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)
  const setActiveCenterView = useUIStore((s) => s.setActiveCenterView)

  // Live elapsed timer - only ticks while working
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (data.agentState !== 'working') return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [data.agentState])

  const elapsed = data.agentState === 'working'
    ? Math.max(0, Math.floor((Date.now() - data.updatedAt) / 1000))
    : 0

  const handleClick = useCallback(() => {
    selectWorktree(data.projectId, data.worktreeId)
    setActiveCenterView({ type: 'terminal', terminalId: data.terminalId })
    setMissionControlActive(false)
  }, [data.projectId, data.worktreeId, data.terminalId, selectWorktree, setActiveCenterView, setMissionControlActive])

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDismiss?.()
  }, [onDismiss])

  const statusClass = STATE_CLASS[data.agentState] ?? ''
  const agentLabel = agentTypeLabel(data.agentType)

  return (
    <div
      className={`mc-card mc-session-card mc-terminal-card${statusClass}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
    >
      {onDismiss && (
        <button
          className="mc-card-dismiss"
          onClick={handleDismiss}
          title={t('dismissTerminal')}
        >
          ✓
        </button>
      )}

      <div className="mc-card-header">
        <span className="mc-card-branch" title={data.branch}>{data.branch}</span>
        <div className="mc-card-header-meta">
          <span className="mc-card-project">{data.projectName}</span>
        </div>
      </div>

      <div className="mc-card-status">
        {data.agentType && data.agentType !== 'unknown'
          ? <AgentIcon agentId={data.agentType} size={12} />
          : <IconTerminal size={12} />}
        <span className="mc-session-name" title={data.terminalLabel}>{data.terminalLabel}</span>
        {elapsed > 0 && (
          <span className="mc-card-elapsed">{formatElapsed(elapsed)}</span>
        )}
        {agentLabel && (
          <Badge variant="muted" size="sm">{agentLabel}</Badge>
        )}
      </div>

      <div className="mc-card-activity-row">
        <span className="mc-card-activity">
          {data.toolName
            ? t('terminalTool', { tool: data.toolName })
            : t(STATE_KEYS[data.agentState] ?? 'terminalDone')}
        </span>
      </div>

      {data.column === 'done' && (
        <div className="mc-card-footer">
          <span className="mc-card-completed-ago">
            {(() => {
              const { key, count } = completedAgoKey(data.updatedAt)
              return t(key, { count })
            })()}
          </span>
        </div>
      )}
    </div>
  )
})
