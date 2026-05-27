import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { IconSparkle } from '@/components/shared/icons'
import type { SupportedLanguage } from '@/store/ui'

const LANGUAGES: { id: SupportedLanguage; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'ja', label: 'Japanese', native: '日本語' },
  { id: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { id: 'zh', label: 'Chinese', native: '中文' },
]

export function WelcomeStep() {
  const { t } = useTranslation('common')
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)

  return (
    <div className="ob-step ob-step--welcome">
      <div className="ob-welcome-brand">
        <IconSparkle size={44} />
      </div>
      <h1 className="ob-heading">{t('onboarding.welcome.title')}</h1>
      <p className="ob-welcome-story">{t('onboarding.welcome.story')}</p>

      <div className="ob-lang-section">
        <span className="ob-lang-label">{t('onboarding.welcome.chooseLang')}</span>
        <div className="ob-lang-grid">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              className={`ob-lang-card${lang.id === language ? ' ob-lang-card--active' : ''}`}
              onClick={() => setLanguage(lang.id)}
              aria-pressed={lang.id === language}
            >
              <span className="ob-lang-native">{lang.native}</span>
              {lang.native !== lang.label && (
                <span className="ob-lang-english">{lang.label}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
