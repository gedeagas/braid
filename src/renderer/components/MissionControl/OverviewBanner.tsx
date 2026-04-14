import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { SK } from '@/lib/storageKeys'

function isDismissed(): boolean {
  try {
    return localStorage.getItem(SK.overviewBannerDismissed) === 'true'
  } catch {
    return false
  }
}

export function OverviewBanner() {
  const { t } = useTranslation('missionControl')
  const setMissionControlActive = useUIStore((s) => s.setMissionControlActive)
  const [dismissed, setDismissed] = useState(isDismissed)

  const handleDismiss = useCallback(() => {
    localStorage.setItem(SK.overviewBannerDismissed, 'true')
    setDismissed(true)
  }, [])

  const handleOpen = useCallback(() => {
    localStorage.setItem(SK.overviewBannerDismissed, 'true')
    setDismissed(true)
    setMissionControlActive(true)
  }, [setMissionControlActive])

  if (dismissed) return null

  return (
    <div className="overview-banner">
      <div className="overview-banner-content">
        <span className="overview-banner-title">{t('bannerTitle')}</span>
        <span className="overview-banner-desc">{t('bannerDescription')}</span>
      </div>
      <div className="overview-banner-actions">
        <button className="btn-primary btn-sm" onClick={handleOpen}>
          {t('bannerOpen')}
        </button>
        <button className="btn-ghost btn-sm" onClick={handleDismiss}>
          {t('bannerDismiss')}
        </button>
      </div>
    </div>
  )
}
