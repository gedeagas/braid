import { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useSessionsStore } from '@/store/sessions'
import { Tooltip } from '@/components/shared/Tooltip'
import { useTranslation } from 'react-i18next'
import { loadRateLimits } from '@/lib/rateLimitCache'
import type { RateLimitInfo } from '@/types'

interface RateLimitBarsProps {
  sessionId: string
}

// Load cached data once at module init (not on every render)
const cachedRateLimits = loadRateLimits()

function getBarColor(utilization: number): string {
  if (utilization >= 0.80) return 'var(--red)'
  if (utilization >= 0.60) return 'var(--amber)'
  return 'var(--green)'
}

function getBarBgColor(utilization: number): string {
  if (utilization >= 0.80) return 'var(--red-tint-15)'
  if (utilization >= 0.60) return 'var(--amber-tint-15)'
  return 'var(--green-tint-15)'
}

function getStatusColor(status: string): string {
  if (status === 'rejected') return 'var(--red)'
  if (status === 'allowed_warning') return 'var(--amber)'
  return 'var(--green)'
}

export function RateLimitBars({ sessionId }: RateLimitBarsProps) {
  const { t } = useTranslation('center')

  const rateLimits = useSessionsStore(
    useShallow((s) => s.sessions[sessionId]?.rateLimits ?? null)
  )

  // Use live data from store, fall back to localStorage cache
  const effectiveLimits = rateLimits ?? cachedRateLimits

  const { fiveHour, sevenDay } = useMemo(() => {
    if (!effectiveLimits) return { fiveHour: null, sevenDay: null }
    const fiveHour = effectiveLimits['five_hour'] ?? null
    const sevenDay = effectiveLimits['seven_day']
      ?? effectiveLimits['seven_day_opus']
      ?? effectiveLimits['seven_day_sonnet']
      ?? null
    return { fiveHour, sevenDay }
  }, [effectiveLimits])

  if (!fiveHour && !sevenDay) return null

  return (
    <Tooltip content={t('rateLimitHeader')} position="top">
      <div className="rate-limit-bars">
        <span className="rate-limit-title">{t('rateLimitTitle')}</span>
        <div className="rate-limit-tracks">
          {fiveHour && (
            <RateLimitRow label={t('rateLimitFiveHour')} info={fiveHour} t={t} />
          )}
          {sevenDay && (
            <RateLimitRow label={t('rateLimitSevenDay')} info={sevenDay} t={t} />
          )}
        </div>
      </div>
    </Tooltip>
  )
}

function RateLimitRow({ label, info, t }: {
  label: string
  info: RateLimitInfo
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  // When utilization is null, the SDK hasn't reported a percentage yet.
  // Show a status dot based on the status field instead of a bar.
  if (info.utilization === null) {
    const statusColor = getStatusColor(info.status)
    return (
      <div className="rate-limit-row">
        <span className="rate-limit-label">{label}</span>
        <div className="rate-limit-track" style={{ background: 'var(--green-tint-15)' }}>
          <div
            className="rate-limit-fill rate-limit-fill--low"
            style={{ background: statusColor }}
          />
        </div>
        <span className="rate-limit-percent rate-limit-percent--ok">OK</span>
      </div>
    )
  }

  const percent = Math.round(info.utilization * 100)
  const barColor = getBarColor(info.utilization)
  const bgColor = getBarBgColor(info.utilization)

  return (
    <div className="rate-limit-row">
      <span className="rate-limit-label">{label}</span>
      <div className="rate-limit-track" style={{ background: bgColor }}>
        <div
          className="rate-limit-fill"
          style={{ width: `${percent}%`, background: barColor }}
        />
      </div>
      <span className="rate-limit-percent">{percent}%</span>
    </div>
  )
}
