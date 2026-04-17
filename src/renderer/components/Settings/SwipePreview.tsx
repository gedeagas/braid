import { useTranslation } from 'react-i18next'

/**
 * Animated preview showing a two-finger horizontal swipe gesture
 * switching between tabs. Pure CSS animation, no external deps.
 */
export function SwipePreview() {
  const { t } = useTranslation('settings')

  return (
    <div className="swipe-preview" aria-hidden="true">
      {/* Mini tab bar */}
      <div className="swipe-preview-tabs">
        <div className="swipe-preview-tab">{t('experimental.previewTab', { n: 1 })}</div>
        <div className="swipe-preview-tab swipe-preview-tab--active">{t('experimental.previewTab', { n: 2 })}</div>
        <div className="swipe-preview-tab">{t('experimental.previewTab', { n: 3 })}</div>
        {/* Sliding active indicator */}
        <div className="swipe-preview-indicator" />
      </div>

      {/* Content area with gesture hint */}
      <div className="swipe-preview-content">
        {/* Two finger dots that swipe horizontally */}
        <div className="swipe-preview-fingers">
          <div className="swipe-preview-finger" />
          <div className="swipe-preview-finger" />
        </div>
        {/* Trail line showing swipe path */}
        <div className="swipe-preview-trail" />
      </div>
    </div>
  )
}
