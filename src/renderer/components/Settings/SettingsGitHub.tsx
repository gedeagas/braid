import { useReducer, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { shell, github } from '@/lib/ipc'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { GhAuthDialog } from '@/components/shared/GhAuthDialog'
import { IconExternalLink } from '@/components/shared/icons'

type ToolStatus = 'checking' | 'installed' | 'not_installed' | 'installing'
type AuthStatus = 'checking' | 'authenticated' | 'not_authenticated'

const GH_DOCS_URL = 'https://cli.github.com'

interface State {
  ghStatus: ToolStatus
  authStatus: AuthStatus
  showAuthDialog: boolean
}

type Action =
  | { type: 'setGh'; status: ToolStatus }
  | { type: 'setAuth'; status: AuthStatus }
  | { type: 'showAuth'; show: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setGh': return { ...state, ghStatus: action.status }
    case 'setAuth': return { ...state, authStatus: action.status }
    case 'showAuth': return { ...state, showAuthDialog: action.show }
  }
}

export function SettingsGitHub() {
  const { t } = useTranslation('settings')

  const [state, dispatch] = useReducer(reducer, {
    ghStatus: 'checking',
    authStatus: 'checking',
    showAuthDialog: false,
  })

  // Check if gh CLI is installed
  useEffect(() => {
    shell
      .checkTool('gh')
      .then((ok: boolean) => dispatch({ type: 'setGh', status: ok ? 'installed' : 'not_installed' }))
      .catch(() => dispatch({ type: 'setGh', status: 'not_installed' }))
  }, [])

  // Check auth status once gh is confirmed installed
  useEffect(() => {
    if (state.ghStatus !== 'installed') {
      dispatch({ type: 'setAuth', status: 'not_authenticated' })
      return
    }
    dispatch({ type: 'setAuth', status: 'checking' })
    shell
      .checkGhAuth()
      .then((ok: boolean) => dispatch({ type: 'setAuth', status: ok ? 'authenticated' : 'not_authenticated' }))
      .catch(() => dispatch({ type: 'setAuth', status: 'not_authenticated' }))
  }, [state.ghStatus])

  const handleInstall = useCallback(async () => {
    dispatch({ type: 'setGh', status: 'installing' })
    try { await shell.installTool('gh') } catch { /* recheck below */ }
    dispatch({ type: 'setGh', status: 'checking' })
    try {
      const ok = await shell.checkTool('gh')
      dispatch({ type: 'setGh', status: ok ? 'installed' : 'not_installed' })
    } catch {
      dispatch({ type: 'setGh', status: 'not_installed' })
    }
  }, [])

  const handleAuthSuccess = useCallback(() => {
    dispatch({ type: 'setAuth', status: 'authenticated' })
  }, [])

  const recheckAuth = useCallback(async () => {
    dispatch({ type: 'setAuth', status: 'checking' })
    try {
      const ok = await shell.checkGhAuth()
      dispatch({ type: 'setAuth', status: ok ? 'authenticated' : 'not_authenticated' })
    } catch {
      dispatch({ type: 'setAuth', status: 'not_authenticated' })
    }
  }, [])

  const ghDot =
    state.ghStatus === 'installed' ? 'success' as const
      : state.ghStatus === 'not_installed' ? 'failure' as const
      : 'pending' as const

  const authDot =
    state.authStatus === 'authenticated' ? 'success' as const
      : state.authStatus === 'not_authenticated' ? 'failure' as const
      : 'pending' as const

  return (
    <div className="settings-section">
      <span className="settings-hint">{t('github.description')}</span>

      <div className="settings-divider" />

      {/* ── GitHub CLI installation ───────────────────────────────────── */}
      <h4 className="settings-section-subtitle">{t('github.cliHeader')}</h4>
      <div className="settings-field settings-field--row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
          <StatusDot state={ghDot} />
          <span className="settings-label">
            {state.ghStatus === 'checking' && t('github.statusChecking')}
            {state.ghStatus === 'installed' && t('github.statusInstalled')}
            {state.ghStatus === 'not_installed' && t('github.statusNotInstalled')}
            {state.ghStatus === 'installing' && t('github.statusInstalling')}
          </span>
        </div>
        {state.ghStatus === 'not_installed' && (
          <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
            <Button size="sm" variant="primary" onClick={handleInstall}>
              {t('github.install')}
            </Button>
            <Button size="sm" onClick={() => shell.openExternal(GH_DOCS_URL)}>
              {t('github.docs')} <IconExternalLink size={10} />
            </Button>
          </div>
        )}
        {state.ghStatus === 'installing' && (
          <Button size="sm" variant="primary" disabled loading>
            {t('github.installing')}
          </Button>
        )}
      </div>
      {state.ghStatus === 'not_installed' && (
        <span className="settings-hint">{t('github.installHint')}</span>
      )}

      <div className="settings-divider" />

      {/* ── Authentication ────────────────────────────────────────────── */}
      <h4 className="settings-section-subtitle">{t('github.authHeader')}</h4>
      <div className="settings-field settings-field--row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
          <StatusDot state={authDot} />
          <span className="settings-label">
            {state.authStatus === 'checking' && t('github.authChecking')}
            {state.authStatus === 'authenticated' && t('github.authAuthenticated')}
            {state.authStatus === 'not_authenticated' && t('github.authNotAuthenticated')}
          </span>
        </div>
        {state.ghStatus === 'installed' && state.authStatus === 'not_authenticated' && (
          <Button size="sm" variant="primary" onClick={() => dispatch({ type: 'showAuth', show: true })}>
            {t('github.signIn')}
          </Button>
        )}
        {state.ghStatus === 'installed' && state.authStatus === 'authenticated' && (
          <Button size="sm" onClick={recheckAuth}>
            {t('github.recheck')}
          </Button>
        )}
      </div>
      {state.ghStatus === 'installed' && state.authStatus === 'not_authenticated' && (
        <span className="settings-hint">{t('github.signInHint')}</span>
      )}

      <GhAuthDialog
        isOpen={state.showAuthDialog}
        onClose={() => dispatch({ type: 'showAuth', show: false })}
        onSuccess={handleAuthSuccess}
      />
    </div>
  )
}
