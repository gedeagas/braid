import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { groupBuiltinThemes } from '@/themes/palettes'
import { applyTheme } from '@/themes/apply'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Toggle } from '@/components/shared/Toggle'
import { FormField } from '@/components/ui'
import type { ThemePalette } from '@/themes/palettes'
import type { TabDisplayMode } from '@/types'
import type { ActivityIndicatorStyle } from '@/store/ui'

function ThemeSwatch({
  theme,
  isActive,
  removeTitle,
  onSelect,
  onDelete,
}: {
  theme: ThemePalette
  isActive: boolean
  removeTitle: string
  onSelect: () => void
  onDelete?: () => void
}) {
  const c = theme.colors
  return (
    <button
      className={`theme-swatch${isActive ? ' theme-swatch--active' : ''}`}
      onClick={onSelect}
      title={theme.name}
    >
      <div className="theme-swatch-colors">
        <div className="theme-swatch-color" style={{ background: c.bgPrimary }} />
        <div className="theme-swatch-color" style={{ background: c.bgSecondary }} />
        <div className="theme-swatch-color" style={{ background: c.accent }} />
        <div className="theme-swatch-color" style={{ background: c.textPrimary }} />
      </div>
      <span className="theme-swatch-name">{theme.name}</span>
      {onDelete && (
        <button
          className="theme-swatch-delete"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title={removeTitle}
        >
          &times;
        </button>
      )}
    </button>
  )
}

export function SettingsAppearance() {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  // const fileInputRef = useRef<HTMLInputElement>(null)
  const activeThemeId = useUIStore((s) => s.activeThemeId)
  const customThemes = useUIStore((s) => s.customThemes)
  const setTheme = useUIStore((s) => s.setTheme)
  const addCustomTheme = useUIStore((s) => s.addCustomTheme)
  const removeCustomTheme = useUIStore((s) => s.removeCustomTheme)
  const uiZoom = useUIStore((s) => s.uiZoom)
  const setUIZoom = useUIStore((s) => s.setUIZoom)
  const tabDisplayMode = useUIStore((s) => s.tabDisplayMode)
  const setTabDisplayMode = useUIStore((s) => s.setTabDisplayMode)
  const activityIndicatorStyle = useUIStore((s) => s.activityIndicatorStyle)
  const setActivityIndicatorStyle = useUIStore((s) => s.setActivityIndicatorStyle)
  const streamingAnimation = useUIStore((s) => s.streamingAnimation)
  const setStreamingAnimation = useUIStore((s) => s.setStreamingAnimation)

  const handleSelect = (theme: ThemePalette) => {
    setTheme(theme.id)
    applyTheme(theme)
  }

  // const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
  //   const file = e.target.files?.[0]
  //   if (!file) return
  //   try {
  //     const text = await file.text()
  //     const theme = importVSCodeTheme(text, file.name)
  //     if (!findTheme(theme.id, customThemes)) addCustomTheme(theme)
  //     setTheme(theme.id)
  //     applyTheme(theme)
  //   } catch (err) {
  //     console.error('[SettingsAppearance] Failed to import VSCode theme:', err)
  //     flash('error', t('appearance.themeImportError'))
  //   }
  //   e.target.value = ''
  // }

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-label">{t('appearance.uiZoom')}</label>
        <div className="settings-stepper">
          <button className="btn" onClick={() => setUIZoom(uiZoom - 0.1)}>−</button>
          <span className="settings-stepper-value">{Math.round(uiZoom * 100)}%</span>
          <button className="btn" onClick={() => setUIZoom(uiZoom + 0.1)}>+</button>
          {uiZoom !== 1.0 && (
            <button className="btn" onClick={() => setUIZoom(1.0)} style={{ marginLeft: 8 }}>
              {t('appearance.uiZoomReset')}
            </button>
          )}
        </div>
      </div>

      <FormField label={t('appearance.tabDisplayMode')} horizontal>
        <SegmentedControl<TabDisplayMode>
          options={[
            { value: 'icons', label: t('appearance.tabDisplayModeIcons') },
            { value: 'labels', label: t('appearance.tabDisplayModeLabels') },
            { value: 'both', label: t('appearance.tabDisplayModeBoth') },
          ]}
          value={tabDisplayMode}
          onChange={setTabDisplayMode}
        />
      </FormField>

      <FormField label={t('appearance.activityIndicator')} horizontal>
        <SegmentedControl<ActivityIndicatorStyle>
          options={[
            { value: 'spinner', label: t('appearance.indicatorSpinner') },
            { value: 'dots', label: t('appearance.indicatorDots') },
            { value: 'waveform', label: t('appearance.indicatorWaveform') },
          ]}
          value={activityIndicatorStyle}
          onChange={setActivityIndicatorStyle}
        />
      </FormField>

      <FormField
        label={t('appearance.streamingAnimation')}
        hint={t('appearance.streamingAnimationHint')}
        horizontal
      >
        <Toggle checked={streamingAnimation} onChange={setStreamingAnimation} />
      </FormField>

      {groupBuiltinThemes().map(({ group, themes }) => (
        <div className="settings-field" key={group}>
          <label className="settings-section-subtitle">
            {t(`appearance.group${group[0].toUpperCase()}${group.slice(1)}`)}
          </label>
          <div className="theme-grid">
            {themes.map((palette) => (
              <ThemeSwatch
                key={palette.id}
                theme={palette}
                isActive={palette.id === activeThemeId}
                removeTitle={tCommon('removeTheme')}
                onSelect={() => handleSelect(palette)}
              />
            ))}
          </div>
        </div>
      ))}

      {customThemes.length > 0 && (
        <div className="settings-field">
          <label className="settings-label">{t('appearance.customThemes')}</label>
          <div className="theme-grid">
            {customThemes.map((palette) => (
              <ThemeSwatch
                key={palette.id}
                theme={palette}
                isActive={palette.id === activeThemeId}
                removeTitle={tCommon('removeTheme')}
                onSelect={() => handleSelect(palette)}
                onDelete={() => removeCustomTheme(palette.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* VSCode theme import - commented out pending shippability review
      <div className="settings-field">
        <button className="btn" onClick={() => fileInputRef.current?.click()}>
          {tCommon('importVSCodeTheme')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.jsonc"
          style={{ display: 'none' }}
          onChange={handleImport}
        />
      </div>
      */}
    </div>
  )
}
