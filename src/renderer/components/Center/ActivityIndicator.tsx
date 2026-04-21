import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { Spinner, BouncingDots, WaveformBars } from '@/components/ui'
import { formatTokens } from '@/lib/constants'

interface Props {
  activity: string
  runStartedAt: number | null
  contextTokens: number | null
  /** Effective context window size (200k or 1M) */
  contextWindow: number
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

function IndicatorIcon() {
  const style = useUIStore((s) => s.activityIndicatorStyle)
  if (style === 'dots') return <BouncingDots size="md" />
  if (style === 'waveform') return <WaveformBars size="md" />
  return <Spinner size="md" />
}

export function ActivityIndicator({ activity, runStartedAt, contextTokens, contextWindow }: Props) {
  const { t } = useTranslation('center')
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!runStartedAt) {
      setElapsed(0)
      return
    }
    setElapsed(Math.floor((Date.now() - runStartedAt) / 1000))
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - runStartedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [runStartedAt])

  const ctxStr = contextTokens != null && contextTokens > 0
    ? t('contextDisplay', {
        percent: Math.round((contextTokens / contextWindow) * 100),
        used: formatTokens(contextTokens),
        total: formatTokens(contextWindow),
      })
    : null

  const parts: string[] = []
  if (runStartedAt) parts.push(formatElapsed(elapsed))
  if (ctxStr) parts.push(ctxStr)
  parts.push(activity)

  return (
    <div className="activity-indicator">
      <IndicatorIcon />
      <span>
        {parts.length > 1 ? (
          <>
            <span className="activity-stats">{parts.slice(0, -1).join(' · ')}</span>
            {' · '}
            {parts[parts.length - 1]}
          </>
        ) : (
          activity
        )}
      </span>
    </div>
  )
}
