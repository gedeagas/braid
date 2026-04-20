import { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useRateLimitsStore } from '@/store/rateLimits'
import { Tooltip } from '@/components/shared/Tooltip'
import { useTranslation } from 'react-i18next'
import type { RateLimitInfo } from '@/types'

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

export function RateLimitBars() {
  const { t } = useTranslation('center')

  const limits = useRateLimitsStore(
    useShallow((s) => s.limits)
  )

  const { fiveHour, sevenDay } = useMemo(() => {
    const fiveHour = limits['five_hour'] ?? null
    const sevenDay = limits['seven_day']
      ?? limits['seven_day_opus']
      ?? limits['seven_day_sonnet']
      ?? null
    return { fiveHour, sevenDay }
  }, [limits])

  if (!fiveHour && !sevenDay) return null

  return (
    <Tooltip content={t('rateLimitHeader')} position="top">
      <span className="rate-limit-bars">
        <span className="rate-limit-title">{t('rateLimitTitle')}</span>
        <span className="rate-limit-tracks">
          {fiveHour && (
            <RateLimitRow label={t('rateLimitFiveHour')} info={fiveHour} t={t} />
          )}
          {sevenDay && (
            <RateLimitRow label={t('rateLimitSevenDay')} info={sevenDay} t={t} />
          )}
        </span>
      </span>
    </Tooltip>
  )
}

function RateLimitRow({ label, info, t }: { label: string; info: RateLimitInfo; t: (k: string) => string }) {
  // When utilization is null, the SDK hasn't reported a percentage yet.
  // Show a status indicator based on the status field instead of a percentage bar.
  if (info.utilization === null) {
    const statusColor = getStatusColor(info.status)
    const isOk = info.status === 'allowed'
    const bgColor = info.status === 'rejected' ? 'var(--red-tint-15)'
      : info.status === 'allowed_warning' ? 'var(--amber-tint-15)'
      : 'var(--green-tint-15)'

    return (
      <span className="rate-limit-row">
        <span className="rate-limit-label">{label}</span>
        <span className="rate-limit-track" style={{ background: bgColor }}>
          <span
            className="rate-limit-fill rate-limit-fill--low"
            style={{ background: statusColor }}
          />
        </span>
        <span className={`rate-limit-percent ${isOk ? 'rate-limit-percent--ok' : ''}`}>
          {isOk ? t('rateLimitOk') : t('rateLimitWarning')}
        </span>
      </span>
    )
  }

  const percent = Math.round(info.utilization * 100)
  const barColor = getBarColor(info.utilization)
  const bgColor = getBarBgColor(info.utilization)

  return (
    <span className="rate-limit-row">
      <span className="rate-limit-label">{label}</span>
      <span className="rate-limit-track" style={{ background: bgColor }}>
        <span
          className="rate-limit-fill"
          style={{ width: `${percent}%`, background: barColor }}
        />
      </span>
      <span className="rate-limit-percent">{percent}%</span>
    </span>
  )
}
