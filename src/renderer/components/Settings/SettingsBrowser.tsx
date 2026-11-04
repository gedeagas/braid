import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserIdentity, BrowserLinkRouting, BrowserSearchEngine } from '@shared/browser'
import { useBrowserStore } from '@/store/browser'
import { Toggle } from '@/components/shared/Toggle'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Button } from '@/components/ui'
import * as ipc from '@/lib/ipc'
import { SettingsBrowserProfiles } from './SettingsBrowserProfiles'

export function SettingsBrowser() {
  const { t } = useTranslation('settings')
  const settings = useBrowserStore((s) => s.settings)
  const update = useBrowserStore((s) => s.updateSettings)
  const load = useBrowserStore((s) => s.loadSettings)
  const [downloadsDraft, setDownloadsDraft] = useState(settings.downloadsDir)
  const modKeys = ipc.shell.platform === 'darwin' ? '\u21E7\u2318' : 'Shift+Ctrl'

  useEffect(() => { void load() }, [load])
  useEffect(() => { setDownloadsDraft(settings.downloadsDir) }, [settings.downloadsDir])

  const chooseDownloads = async () => {
    const dir = await ipc.dialog.openDirectory() as string | null
    if (dir) void update({ downloadsDir: dir })
  }

  return (
    <div className="settings-section">
      <h4 className="settings-section-subtitle">{t('browser.linksHeader')}</h4>
      <div className="settings-field settings-field--row">
        <label className="settings-label">{t('browser.linkRouting')}</label>
        <SegmentedControl<BrowserLinkRouting>
          options={[{ value: 'braid', label: t('browser.linkRoutingBraid') }, { value: 'system', label: t('browser.linkRoutingSystem') }]}
          value={settings.linkRouting}
          onChange={(v) => void update({ linkRouting: v })}
        />
      </div>
      <span className="settings-hint">{t('browser.linkRoutingHint')}</span>
      <div className="settings-field settings-field--row">
        <label className="settings-label">
          {t('browser.invertModifier', { keys: modKeys })}
        </label>
        <Toggle checked={settings.invertWithShiftModifier} onChange={(v) => void update({ invertWithShiftModifier: v })} />
      </div>
      <span className="settings-hint">
        {t(settings.linkRouting === 'braid' ? 'browser.invertModifierHintBraid' : 'browser.invertModifierHintSystem', { keys: modKeys })}
      </span>

      <div className="settings-divider" />
      <h4 className="settings-section-subtitle">{t('browser.generalHeader')}</h4>
      <div className="settings-field settings-field--row">
        <label className="settings-label">{t('browser.searchEngine')}</label>
        <SegmentedControl<BrowserSearchEngine>
          options={[{ value: 'google', label: 'Google' }, { value: 'duckduckgo', label: 'DuckDuckGo' }, { value: 'bing', label: 'Bing' }]}
          value={settings.searchEngine}
          onChange={(v) => void update({ searchEngine: v })}
        />
      </div>
      <div className="settings-field">
        <label className="settings-label">{t('browser.downloadsDir')}</label>
        <div className="settings-input-row">
          <input
            className="settings-input"
            value={downloadsDraft}
            placeholder={t('browser.downloadsDirPlaceholder')}
            onChange={(e) => setDownloadsDraft(e.target.value)}
            onBlur={() => { if (downloadsDraft !== settings.downloadsDir) void update({ downloadsDir: downloadsDraft.trim() }) }}
          />
          <Button size="sm" onClick={() => void chooseDownloads()}>{t('browser.choose')}</Button>
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-label">{t('browser.identity')}</label>
        <SegmentedControl<BrowserIdentity>
          options={[{ value: 'cleaned', label: t('browser.identityCleaned') }, { value: 'native', label: t('browser.identityNative') }]}
          value={settings.identity}
          onChange={(v) => void update({ identity: v })}
        />
        <span className="settings-hint">{t('browser.identityHint')}</span>
      </div>

      <div className="settings-divider" />
      <h4 className="settings-section-subtitle">{t('browser.agentsHeader')}</h4>
      <div className="settings-field settings-field--row">
        <label className="settings-label">{t('browser.exposeToAgents')}</label>
        <Toggle checked={settings.exposeToTerminalAgents} onChange={(v) => void update({ exposeToTerminalAgents: v })} />
      </div>
      <span className="settings-hint">{t('browser.exposeToAgentsHint')}</span>

      <div className="settings-divider" />
      <SettingsBrowserProfiles />
    </div>
  )
}
