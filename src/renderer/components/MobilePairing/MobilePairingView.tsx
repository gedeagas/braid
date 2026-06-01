import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { SettingsMobile } from '@/components/Settings/SettingsMobile'
import { IconClose } from '@/components/shared/icons'

/**
 * Full-page overlay for enabling the mobile companion server and pairing the
 * Braid mobile app. Opened from the ActivityBar entry below Mission Control.
 *
 * The pairing controls are identical to Settings > Mobile, so we reuse
 * <SettingsMobile /> rather than duplicating the server/QR/device logic.
 */
export function MobilePairingView() {
  const { t } = useTranslation('sidebar')
  const mobilePairingActive = useUIStore((s) => s.mobilePairingActive)
  const toggleMobilePairing = useUIStore((s) => s.toggleMobilePairing)

  // Escape dismisses the page (only while visible), matching Mission Control.
  useEffect(() => {
    if (!mobilePairingActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleMobilePairing()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobilePairingActive, toggleMobilePairing])

  const handleClose = useCallback(() => toggleMobilePairing(), [toggleMobilePairing])

  return (
    <div className="mobile-pairing">
      <div className="mobile-pairing-header">
        <div className="drag-region" />
        <span className="mobile-pairing-title">{t('mobilePairing')}</span>
        <button className="btn-icon" onClick={handleClose} aria-label={t('mobilePairing')}>
          <IconClose size={11} />
        </button>
      </div>
      <div className="mobile-pairing-body">
        <div className="mobile-pairing-content">
          <SettingsMobile />
        </div>
      </div>
    </div>
  )
}
