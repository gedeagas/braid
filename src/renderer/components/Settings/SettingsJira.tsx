import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { jira, shell } from '@/lib/ipc'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { IconExternalLink } from '@/components/shared/icons'

type AcliStatus = 'checking' | 'installed' | 'not_installed' | 'installing'
type SaveState = 'idle' | 'saved'

const ACLI_DOCS_URL = 'https://developer.atlassian.com/cloud/acli/guides/install-acli/'

export function SettingsJira() {
  const { t } = useTranslation('settings')
  const jiraBaseUrl = useUIStore((s) => s.jiraBaseUrl)
  const setJiraBaseUrl = useUIStore((s) => s.setJiraBaseUrl)

  const [acliStatus, setAcliStatus] = useState<AcliStatus>('checking')
  const [jiraDraft, setJiraDraft] = useState(jiraBaseUrl)

  useEffect(() => {
    jira.isAvailable().then((ok: boolean) => setAcliStatus(ok ? 'installed' : 'not_installed'))
  }, [])

  const handleInstall = useCallback(async () => {
    setAcliStatus('installing')
    try { await shell.installTool('acli') } catch { /* still recheck below */ }
    setAcliStatus('checking')
    const ok = await jira.recheckAvailability()
    setAcliStatus(ok ? 'installed' : 'not_installed')
  }, [])

  // ── Base URL save with brief "Saved" flash ──────────────────────────
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const dirty = jiraDraft.trim() !== jiraBaseUrl

  const handleSave = useCallback(() => {
    setJiraBaseUrl(jiraDraft.trim())
    setSaveState('saved')
    setTimeout(() => setSaveState('idle'), 1500)
  }, [jiraDraft, setJiraBaseUrl])

  const dotState =
    acliStatus === 'installed' ? 'success' as const
      : acliStatus === 'not_installed' ? 'failure' as const
      : 'pending' as const

  return (
    <div className="settings-section">
      <span className="settings-hint">{t('jira.description')}</span>

      <div className="settings-divider" />

      <h4 className="settings-section-subtitle">{t('jira.statusHeader')}</h4>
      <div className="settings-field settings-field--row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
          <StatusDot state={dotState} />
          <span className="settings-label">
            {acliStatus === 'checking' && t('jira.statusChecking')}
            {acliStatus === 'installed' && t('jira.statusInstalled')}
            {acliStatus === 'not_installed' && t('jira.statusNotInstalled')}
            {acliStatus === 'installing' && t('jira.statusInstalling')}
          </span>
        </div>
        {acliStatus === 'not_installed' && (
          <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
            <Button size="sm" variant="primary" onClick={handleInstall}>
              {t('jira.install')}
            </Button>
            <Button size="sm" onClick={() => shell.openExternal(ACLI_DOCS_URL)}>
              {t('jira.docs')} <IconExternalLink size={10} />
            </Button>
          </div>
        )}
        {acliStatus === 'installing' && (
          <Button size="sm" variant="primary" disabled loading>
            {t('jira.installing')}
          </Button>
        )}
      </div>

      <div className="settings-divider" />

      <div className="settings-field">
        <label className="settings-label">{t('jira.baseUrl')}</label>
        <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
          <input
            type="text"
            className="settings-input"
            style={{ flex: 1 }}
            value={jiraDraft}
            onChange={(e) => setJiraDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) handleSave() }}
            placeholder="https://yourcompany.atlassian.net"
            spellCheck={false}
          />
          <Button size="sm" variant="primary" disabled={!dirty && saveState === 'idle'} onClick={handleSave}>
            {saveState === 'saved' ? t('jira.saved') : t('jira.save')}
          </Button>
        </div>
        <span className="settings-hint">{t('jira.baseUrlHint')}</span>
      </div>
    </div>
  )
}
