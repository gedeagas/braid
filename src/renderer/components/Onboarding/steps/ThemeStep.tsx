import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { builtinThemes, type ThemePalette } from '@/themes/palettes'
import { applyTheme } from '@/themes/apply'
import { IconCheckFill } from '@/components/shared/icons'

const FEATURED_IDS = ['ocean-dark', 'ocean-light', 'amethyst']

function ThemeCard({ theme, isActive, onSelect }: {
  theme: ThemePalette
  isActive: boolean
  onSelect: () => void
}) {
  const c = theme.colors
  return (
    <button
      className={`ob-theme-card${isActive ? ' ob-theme-card--active' : ''}`}
      onClick={onSelect}
      aria-pressed={isActive}
    >
      {isActive && (
        <div className="ob-theme-check">
          <IconCheckFill size={16} />
        </div>
      )}
      <div className="ob-theme-preview" style={{ background: c.bgPrimary }}>
        <div className="ob-theme-preview-sidebar" style={{ background: c.bgSecondary, borderRight: `1px solid ${c.border}` }}>
          <div className="ob-theme-preview-line" style={{ background: c.textMuted, width: '60%' }} />
          <div className="ob-theme-preview-line" style={{ background: c.accent, width: '80%' }} />
          <div className="ob-theme-preview-line" style={{ background: c.textMuted, width: '50%' }} />
        </div>
        <div className="ob-theme-preview-main">
          <div className="ob-theme-preview-topbar" style={{ borderBottom: `1px solid ${c.border}` }}>
            <div className="ob-theme-preview-dot" style={{ background: c.accent }} />
            <div className="ob-theme-preview-line" style={{ background: c.textMuted, width: '40%' }} />
          </div>
          <div className="ob-theme-preview-lines">
            <div className="ob-theme-preview-line" style={{ background: c.textPrimary, width: '90%' }} />
            <div className="ob-theme-preview-line" style={{ background: c.textSecondary, width: '70%' }} />
            <div className="ob-theme-preview-line" style={{ background: c.textSecondary, width: '55%' }} />
          </div>
        </div>
      </div>
      <div className="ob-theme-card-label">
        <span className="ob-theme-card-name">{theme.name}</span>
        <span className="ob-theme-card-hint">
          {theme.type === 'dark' ? 'Dark' : 'Light'}
        </span>
      </div>
    </button>
  )
}

export function ThemeStep() {
  const { t } = useTranslation('common')
  const activeThemeId = useUIStore((s) => s.activeThemeId)
  const setTheme = useUIStore((s) => s.setTheme)

  const featured = FEATURED_IDS.map((id) => builtinThemes.find((t) => t.id === id)!).filter(Boolean)

  const handleSelect = (theme: ThemePalette) => {
    setTheme(theme.id)
    applyTheme(theme)
  }

  return (
    <div className="ob-step">
      <h1 className="ob-heading">{t('onboarding.theme.title')}</h1>
      <p className="ob-subtitle">{t('onboarding.theme.subtitle')}</p>

      <div className="ob-theme-grid">
        {featured.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            isActive={theme.id === activeThemeId}
            onSelect={() => handleSelect(theme)}
          />
        ))}
      </div>

      <p className="ob-hint">{t('onboarding.theme.moreHint')}</p>
    </div>
  )
}
