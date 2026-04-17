import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { Toggle } from '@/components/shared/Toggle'
import { Card, FormField } from '@/components/ui'
import { SwipePreview } from './SwipePreview'

interface Feature {
  id: string
  labelKey: string
  hintKey?: string
  preview?: React.ReactNode
}

const FEATURES: Feature[] = [
  {
    id: 'magicTrackpad',
    labelKey: 'experimental.magicTrackpad',
    hintKey: 'experimental.magicTrackpadHint',
    preview: <SwipePreview />,
  },
]

export function SettingsExperimental() {
  const { t } = useTranslation('settings')
  const [selectedId, setSelectedId] = useState(FEATURES[0].id)

  const magicTrackpad = useUIStore((s) => s.magicTrackpad)
  const setMagicTrackpad = useUIStore((s) => s.setMagicTrackpad)
  const experimentalCapture = useUIStore((s) => s.experimentalCapture)
  const setExperimentalCapture = useUIStore((s) => s.setExperimentalCapture)
  const experimentalAcp = useUIStore((s) => s.experimentalAcp)
  const setExperimentalAcp = useUIStore((s) => s.setExperimentalAcp)
  const bottomTerminalEnabled = useUIStore((s) => s.bottomTerminalEnabled)
  const setBottomTerminalEnabled = useUIStore((s) => s.setBottomTerminalEnabled)
  const experimentalNoVirtualization = useUIStore((s) => s.experimentalNoVirtualization)
  const setExperimentalNoVirtualization = useUIStore((s) => s.setExperimentalNoVirtualization)

  const selected = FEATURES.find((f) => f.id === selectedId) ?? FEATURES[0]

  const toggleForFeature = (id: string): { checked: boolean; onChange: (v: boolean) => void } => {
    switch (id) {
      case 'magicTrackpad': return { checked: magicTrackpad, onChange: setMagicTrackpad }
      default: return { checked: false, onChange: () => {} }
    }
  }

  return (
    <div className="settings-section">
      <span className="settings-hint">{t('experimental.hint')}</span>

      {/* Feature list + detail layout */}
      <div className="experimental-layout">
        <div className="experimental-feature-list" aria-label={t('experimental.features')}>
          {FEATURES.map((f) => {
            const isSelected = selectedId === f.id
            return (
              <div
                key={f.id}
                className={`experimental-feature-item${isSelected ? ' experimental-feature-item--active' : ''}`}
                onClick={() => setSelectedId(f.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(f.id) } }}
                tabIndex={0}
                role="button"
                aria-pressed={isSelected}
              >
                <span className="experimental-feature-name">{t(f.labelKey)}</span>
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div onClick={(e) => e.stopPropagation()}>
                  <Toggle {...toggleForFeature(f.id)} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="experimental-detail">
          {selected.preview && (
            <div className="experimental-preview">
              {selected.preview}
            </div>
          )}
          {selected.hintKey && (
            <p className="experimental-detail-hint">{t(selected.hintKey)}</p>
          )}
        </div>
      </div>

      {/* Legacy experimental flags */}
      <div className="settings-divider" />

      <Card title={t('experimental.otherFlags')} className="settings-card">
        <FormField label={t('general.experimentalCapture')} horizontal>
          <Toggle checked={experimentalCapture} onChange={setExperimentalCapture} />
        </FormField>

        <FormField label={t('general.experimentalAcp')} hint={t('general.experimentalAcpHint')} horizontal>
          <Toggle checked={experimentalAcp} onChange={setExperimentalAcp} />
        </FormField>

        <FormField label={t('general.bottomTerminal')} hint={t('general.bottomTerminalHint')} horizontal>
          <Toggle checked={bottomTerminalEnabled} onChange={setBottomTerminalEnabled} />
        </FormField>

        <FormField label={t('general.noVirtualization')} hint={t('general.noVirtualizationHint')} horizontal>
          <Toggle checked={experimentalNoVirtualization} onChange={setExperimentalNoVirtualization} />
        </FormField>
      </Card>
    </div>
  )
}
