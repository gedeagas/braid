import { useTranslation } from 'react-i18next'
import { VERSION_CODENAME } from '@/lib/appBrand'
import pkg from '../../../../package.json'

export function SettingsAbout() {
  const { t } = useTranslation('settings')

  return (
    <div className="settings-section">
      {/* Hero */}
      <div className="settings-about-hero">
        <div className="settings-about-wordmark-row">
          <span className="settings-about-wordmark">Braid</span>
          <span className="settings-about-version">
            {t('about.version', { version: pkg.version })}
          </span>
        </div>
        <p className="settings-about-codename">{VERSION_CODENAME}</p>
        <p className="settings-about-tagline">{t('about.tagline')}</p>
      </div>

      {/* Mission */}
      <div className="settings-card">
        <p className="settings-card-title">{t('about.missionTitle')}</p>
        <p className="settings-about-body">{t('about.mission')}</p>
      </div>

      {/* Capabilities */}
      <div className="settings-card">
        <p className="settings-card-title">{t('about.capabilitiesTitle')}</p>
        <ul className="settings-about-features">
          {(['cap1', 'cap2', 'cap3', 'cap4'] as const).map((key) => (
            <li key={key} className="settings-about-feature">
              <span className="settings-about-feature-dot" />
              <span>{t(`about.${key}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Creator footer */}
      <div className="settings-about-footer">
        <span className="settings-about-creator">{t('about.createdBy')}</span>
        <span className="settings-about-meta">{t('about.builtIn')}</span>
      </div>
    </div>
  )
}
