import { useTranslation } from 'react-i18next'
import { VERSION_CODENAME } from '@/lib/appBrand'
import { Button } from '@/components/ui'
import { useAutoUpdate } from '@/hooks/useAutoUpdate'
import pkg from '../../../../package.json'

const CONTRIBUTORS = [
  { name: 'Adam Akbar', github: 'asaadam' },
  { name: 'Agastya Darma', github: 'gedeagas' },
  { name: 'Eko Prasetyo L. N. H.', github: 'eplnh' },
  { name: 'Hanif NR', github: 'hanifnr' },
]

export function SettingsAbout() {
  const { t } = useTranslation(['settings', 'common'])
  const { state, checkForUpdates } = useAutoUpdate()

  const isChecking = state.status === 'checking'
  const isDisabled = isChecking || state.status === 'downloading'

  return (
    <div className="settings-section">
      {/* Hero */}
      <div className="settings-about-hero">
        <div className="settings-about-wordmark-row">
          <span className="settings-about-wordmark">Braid</span>
          <span className="settings-about-version">
            {t('about.version', { version: pkg.version, ns: 'settings' })}
          </span>
        </div>
        <p className="settings-about-codename">{VERSION_CODENAME}</p>
        <p className="settings-about-tagline">{t('about.tagline', { ns: 'settings' })}</p>
      </div>

      {/* Check for updates */}
      <div className="settings-field settings-field--row">
        <div>
          <label className="settings-label">{t('update.check', { ns: 'common' })}</label>
          {state.status === 'upToDate' && (
            <p className="settings-hint settings-about-uptodate">
              {t('update.upToDate', { ns: 'common' })}
            </p>
          )}
        </div>
        <Button
          size="sm"
          loading={isChecking}
          disabled={isDisabled}
          onClick={checkForUpdates}
        >
          {t('update.check', { ns: 'common' })}
        </Button>
      </div>

      {/* Mission */}
      <div className="settings-card">
        <p className="settings-card-title">{t('about.missionTitle', { ns: 'settings' })}</p>
        <p className="settings-about-body">{t('about.mission', { ns: 'settings' })}</p>
      </div>

      {/* Capabilities */}
      <div className="settings-card">
        <p className="settings-card-title">{t('about.capabilitiesTitle', { ns: 'settings' })}</p>
        <ul className="settings-about-features">
          {(['cap1', 'cap2', 'cap3', 'cap4'] as const).map((key) => (
            <li key={key} className="settings-about-feature">
              <span className="settings-about-feature-dot" />
              <span>{t(`about.${key}`, { ns: 'settings' })}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Contributors */}
      <div className="settings-card">
        <p className="settings-card-title">{t('about.contributorsTitle', { ns: 'settings' })}</p>
        <p className="settings-about-body">{t('about.contributorsThanks', { ns: 'settings' })}</p>
        <div className="settings-about-contributors">
          {CONTRIBUTORS.map((c) => (
            <div key={c.github} className="settings-about-contributor">
              <img
                className="settings-about-contributor-avatar"
                src={`https://github.com/${c.github}.png?size=64`}
                alt={c.name}
              />
              <div className="settings-about-contributor-info">
                <span className="settings-about-contributor-name">{c.name}</span>
                <span className="settings-about-contributor-handle">@{c.github}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Creator footer */}
      <div className="settings-about-footer">
        <span className="settings-about-creator">{t('about.createdBy', { ns: 'settings' })}</span>
        <span className="settings-about-meta">{t('about.builtIn', { ns: 'settings' })}</span>
      </div>
    </div>
  )
}
