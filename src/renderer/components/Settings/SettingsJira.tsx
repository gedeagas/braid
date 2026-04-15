import { useReducer, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { jira, shell } from '@/lib/ipc'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { IconExternalLink } from '@/components/shared/icons'

type AcliStatus = 'checking' | 'installed' | 'not_installed' | 'installing'
type SaveState = 'idle' | 'saved'

const ACLI_DOCS_URL = 'https://developer.atlassian.com/cloud/acli/guides/install-acli/'

interface State {
  acliStatus: AcliStatus
  draft: string
  saveState: SaveState
}

type Action =
  | { type: 'setAcli'; status: AcliStatus }
  | { type: 'setDraft'; value: string }
  | { type: 'saved' }
  | { type: 'resetSave' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setAcli': return { ...state, acliStatus: action.status }
    case 'setDraft': return { ...state, draft: action.value, saveState: 'idle' }
    case 'saved': return { ...state, saveState: 'saved' }
    case 'resetSave': return { ...state, saveState: 'idle' }
  }
}

export function SettingsJira() {
  const { t } = useTranslation('settings')
  const jiraBaseUrl = useUIStore((s) => s.jiraBaseUrl)
  const setJiraBaseUrl = useUIStore((s) => s.setJiraBaseUrl)

  const [state, dispatch] = useReducer(reducer, {
    acliStatus: 'checking',
    draft: jiraBaseUrl,
    saveState: 'idle',
  })

  useEffect(() => {
    jira.isAvailable().then((ok: boolean) => dispatch({ type: 'setAcli', status: ok ? 'installed' : 'not_installed' }))
  }, [])

  const handleInstall = useCallback(async () => {
    dispatch({ type: 'setAcli', status: 'installing' })
    try { await shell.installTool('acli') } catch { /* still recheck below */ }
    dispatch({ type: 'setAcli', status: 'checking' })
    const ok = await jira.recheckAvailability()
    dispatch({ type: 'setAcli', status: ok ? 'installed' : 'not_installed' })
  }, [])

  // ── Base URL save with brief "Saved" flash ──────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const dirty = state.draft.trim() !== jiraBaseUrl

  const handleSave = useCallback(() => {
    setJiraBaseUrl(state.draft.trim())
    dispatch({ type: 'saved' })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => dispatch({ type: 'resetSave' }), 1500)
  }, [state.draft, setJiraBaseUrl])

  const dotState =
    state.acliStatus === 'installed' ? 'success' as const
      : state.acliStatus === 'not_installed' ? 'failure' as const
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
            {state.acliStatus === 'checking' && t('jira.statusChecking')}
            {state.acliStatus === 'installed' && t('jira.statusInstalled')}
            {state.acliStatus === 'not_installed' && t('jira.statusNotInstalled')}
            {state.acliStatus === 'installing' && t('jira.statusInstalling')}
          </span>
        </div>
        {state.acliStatus === 'not_installed' && (
          <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
            <Button size="sm" variant="primary" onClick={handleInstall}>
              {t('jira.install')}
            </Button>
            <Button size="sm" onClick={() => shell.openExternal(ACLI_DOCS_URL)}>
              {t('jira.docs')} <IconExternalLink size={10} />
            </Button>
          </div>
        )}
        {state.acliStatus === 'installing' && (
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
            value={state.draft}
            onChange={(e) => dispatch({ type: 'setDraft', value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) handleSave() }}
            placeholder="https://yourcompany.atlassian.net"
            spellCheck={false}
          />
          <Button size="sm" variant="primary" disabled={!dirty && state.saveState === 'idle'} onClick={handleSave}>
            {state.saveState === 'saved' ? t('jira.saved') : t('jira.save')}
          </Button>
        </div>
        <span className="settings-hint">{t('jira.baseUrlHint')}</span>
      </div>
    </div>
  )
}
