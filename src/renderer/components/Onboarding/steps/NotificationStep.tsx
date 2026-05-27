import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { Toggle } from '@/components/shared/Toggle'
import { Button } from '@/components/ui/Button'
import { shell } from '@/lib/ipc'
import { IconSettings } from '@/components/shared/icons'
import { flash } from '@/store/flash'

export function NotificationStep() {
  const { t } = useTranslation('common')
  const notificationSound = useUIStore((s) => s.notificationSound)
  const setNotificationSound = useUIStore((s) => s.setNotificationSound)

  const openMacSettings = () => {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications')
  }

  const sendTestNotification = () => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      flash('warning', t('onboarding.notifications.permissionRequired'))
      return
    }

    try {
      new Notification('Braid', {
        body: t('onboarding.notifications.testBody'),
      })
    } catch {
      flash('warning', t('onboarding.notifications.permissionRequired'))
    }
  }

  return (
    <div className="ob-step">
      <h1 className="ob-heading">{t('onboarding.notifications.title')}</h1>
      <p className="ob-subtitle">{t('onboarding.notifications.subtitle')}</p>

      <div className="ob-notif-permission">
        <div className="ob-notif-permission-icon">
          <IconSettings size={18} />
        </div>
        <div className="ob-notif-permission-body">
          <span className="ob-notif-permission-title">{t('onboarding.notifications.allowTitle')}</span>
          <span className="ob-notif-permission-desc">{t('onboarding.notifications.allowDesc')}</span>
        </div>
        <Button onClick={openMacSettings}>
          {t('onboarding.notifications.openMacSettings')}
        </Button>
      </div>

      <div className="ob-notif-sound-section">
        <h4 className="ob-notif-sound-heading">{t('onboarding.notifications.chooseSound')}</h4>
        <p className="ob-notif-sound-hint">{t('onboarding.notifications.chooseSoundHint')}</p>

        <div className="ob-notif-sound-row">
          <div className="ob-notif-sound-toggle">
            <span className="ob-notif-sound-label">{t('onboarding.notifications.sound')}</span>
            <Toggle checked={notificationSound} onChange={setNotificationSound} />
          </div>
          <Button size="sm" onClick={sendTestNotification}>
            {t('onboarding.notifications.sendTest')}
          </Button>
        </div>
      </div>
    </div>
  )
}
