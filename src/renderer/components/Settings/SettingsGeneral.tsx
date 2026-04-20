import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { Toggle } from '@/components/shared/Toggle'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Button, FormField } from '@/components/ui'
import type { SupportedLanguage, ToolMessageStyle } from '@/store/ui'

const LANGUAGES: { value: SupportedLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'zh', label: '简体中文' },
]

export function SettingsGeneral() {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)
  const toolMessageStyle = useUIStore((s) => s.toolMessageStyle)
  const setToolMessageStyle = useUIStore((s) => s.setToolMessageStyle)
  const skipDeleteWorktreeConfirm = useUIStore((s) => s.skipDeleteWorktreeConfirm)
  const setSkipDeleteWorktreeConfirm = useUIStore((s) => s.setSkipDeleteWorktreeConfirm)
  const setFeatureTourComplete = useUIStore((s) => s.setFeatureTourComplete)
  const closeSettings = useUIStore((s) => s.closeSettings)

  const toolStyleOptions: { value: ToolMessageStyle; label: string }[] = [
    { value: 'funny', label: t('general.toolStyleFunny') },
    { value: 'boring', label: t('general.toolStyleBoring') },
  ]

  return (
    <div className="settings-section">
      <FormField label={tCommon('language')}>
        <select
          className="settings-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
        >
          {LANGUAGES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </FormField>

      <FormField label={t('general.toolStyle')}>
        <SegmentedControl
          options={toolStyleOptions}
          value={toolMessageStyle}
          onChange={setToolMessageStyle}
        />
      </FormField>

      <FormField label={t('general.skipDeleteConfirm')} horizontal>
        <Toggle checked={skipDeleteWorktreeConfirm} onChange={setSkipDeleteWorktreeConfirm} />
      </FormField>

      <FormField label={t('general.replayTour')} hint={t('general.replayTourHint')} horizontal>
        <Button
          size="sm"
          onClick={() => {
            setFeatureTourComplete(false)
            closeSettings()
          }}
        >
          {t('general.replayTour')}
        </Button>
      </FormField>
    </div>
  )
}
