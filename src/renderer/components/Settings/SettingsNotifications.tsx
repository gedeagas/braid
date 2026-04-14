import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { Toggle } from '@/components/shared/Toggle'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { FormField } from '@/components/ui'
import type { ToastSize, ToastPosition, ToastDuration } from '@/types'

const SIZE_SPECS: Record<ToastSize, { width: number; titleSize: number; detailSize: number; iconSize: number; padding: string }> = {
  small:  { width: 280, titleSize: 11, detailSize: 10, iconSize: 12, padding: '8px 10px' },
  medium: { width: 320, titleSize: 12, detailSize: 11, iconSize: 12, padding: '10px 12px' },
  large:  { width: 400, titleSize: 13, detailSize: 12, iconSize: 14, padding: '12px 14px' },
}

function ToastPreview({ size, disabled }: { size: ToastSize; disabled: boolean }) {
  const { t } = useTranslation('common')
  const spec = SIZE_SPECS[size]

  return (
    <div className={`toast-preview-area${disabled ? ' toast-preview-area--disabled' : ''}`}>
      <div className="toast-preview" style={{ width: spec.width, padding: spec.padding }}>
        <div className="toast-preview__header">
          <span className="toast-preview__icon" style={{ fontSize: spec.iconSize }}>✓</span>
          <span className="toast-preview__title" style={{ fontSize: spec.titleSize }}>{t('toastDone')}</span>
          <span className="toast-preview__dismiss">×</span>
        </div>
        <div className="toast-preview__detail" style={{ fontSize: spec.detailSize, paddingLeft: spec.iconSize + 8 }}>
          main · Session 1
        </div>
        <div className="toast-preview__progress" />
      </div>
      <span className="toast-preview__width-label">{spec.width}px</span>
    </div>
  )
}

export function SettingsNotifications() {
  const { t } = useTranslation('settings')
  const notifyOnDone = useUIStore((s) => s.notifyOnDone)
  const setNotifyOnDone = useUIStore((s) => s.setNotifyOnDone)
  const notifyOnError = useUIStore((s) => s.notifyOnError)
  const setNotifyOnError = useUIStore((s) => s.setNotifyOnError)
  const notifyOnWaitingInput = useUIStore((s) => s.notifyOnWaitingInput)
  const setNotifyOnWaitingInput = useUIStore((s) => s.setNotifyOnWaitingInput)
  const notificationSound = useUIStore((s) => s.notificationSound)
  const setNotificationSound = useUIStore((s) => s.setNotificationSound)
  const notificationVolume = useUIStore((s) => s.notificationVolume)
  const setNotificationVolume = useUIStore((s) => s.setNotificationVolume)
  const inAppNotifications = useUIStore((s) => s.inAppNotifications)
  const setInAppNotifications = useUIStore((s) => s.setInAppNotifications)
  const toastSize = useUIStore((s) => s.toastSize)
  const setToastSize = useUIStore((s) => s.setToastSize)
  const toastPosition = useUIStore((s) => s.toastPosition)
  const setToastPosition = useUIStore((s) => s.setToastPosition)
  const toastDuration = useUIStore((s) => s.toastDuration)
  const setToastDuration = useUIStore((s) => s.setToastDuration)

  const sizeOptions: { value: ToastSize; label: string }[] = [
    { value: 'small', label: t('notifications.sizeSmall') },
    { value: 'medium', label: t('notifications.sizeMedium') },
    { value: 'large', label: t('notifications.sizeLarge') },
  ]

  const durationOptions: { value: ToastDuration; label: string }[] = [
    { value: 5, label: t('notifications.duration5') },
    { value: 10, label: t('notifications.duration10') },
    { value: 15, label: t('notifications.duration15') },
  ]

  const positionOptions: { value: ToastPosition; label: string }[] = [
    { value: 'bottom-left', label: t('notifications.positionBottomLeft') },
    { value: 'bottom-right', label: t('notifications.positionBottomRight') },
    { value: 'top-center', label: t('notifications.positionTopCenter') },
  ]

  return (
    <div className="settings-section">
      <h4 className="settings-section-subtitle">{t('notifications.desktopHeader')}</h4>

      <FormField label={t('notifications.onDone')} horizontal>
        <Toggle checked={notifyOnDone} onChange={setNotifyOnDone} />
      </FormField>
      <FormField label={t('notifications.onError')} horizontal>
        <Toggle checked={notifyOnError} onChange={setNotifyOnError} />
      </FormField>
      <FormField label={t('notifications.onWaiting')} horizontal>
        <Toggle checked={notifyOnWaitingInput} onChange={setNotifyOnWaitingInput} />
      </FormField>
      <FormField label={t('notifications.sound')} horizontal>
        <Toggle checked={notificationSound} onChange={setNotificationSound} />
      </FormField>

      <div
        className="settings-field settings-field--row"
        style={{ opacity: notificationSound ? 1 : 0.4, pointerEvents: notificationSound ? 'auto' : 'none' }}
      >
        <label className="settings-label">{t('notifications.volume')}</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={notificationVolume}
          disabled={!notificationSound}
          onChange={(e) => setNotificationVolume(Number(e.target.value))}
          className="settings-volume-slider"
        />
        <span className="settings-volume-pct">{Math.round(notificationVolume * 100)}%</span>
      </div>

      <h4 className="settings-section-subtitle">{t('notifications.inAppHeader')}</h4>

      <FormField label={t('notifications.inApp')} horizontal>
        <Toggle checked={inAppNotifications} onChange={setInAppNotifications} />
      </FormField>

      <FormField label={t('notifications.size')} horizontal>
        <SegmentedControl options={sizeOptions} value={toastSize} onChange={setToastSize} disabled={!inAppNotifications} />
      </FormField>

      <FormField label={t('notifications.duration')} horizontal>
        <SegmentedControl options={durationOptions} value={toastDuration} onChange={setToastDuration} disabled={!inAppNotifications} />
      </FormField>

      <ToastPreview size={toastSize} disabled={!inAppNotifications} />

      <FormField label={t('notifications.position')} horizontal>
        <SegmentedControl options={positionOptions} value={toastPosition} onChange={setToastPosition} disabled={!inAppNotifications} />
      </FormField>
    </div>
  )
}
