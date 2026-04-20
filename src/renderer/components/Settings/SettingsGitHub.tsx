import { useReducer, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { shell } from '@/lib/ipc'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { GhAuthDialog } from '@/components/shared/GhAuthDialog'
import { IconExternalLink } from '@/components/shared/icons'

// ── Types ──────────────────────────────────────────────────────────────────────

type ToolStatus = 'checking' | 'installed' | 'not_installed' | 'installing'
type AuthStatus = 'checking' | 'authenticated' | 'not_authenticated'

const GH_DOCS_URL = 'https://cli.github.com'

// ── Status label maps ──────────────────────────────────────────────────────────

const GH_STATUS_KEY: Record<ToolStatus, string> = {
  checking: 'github.statusChecking',
  installed: 'github.statusInstalled',
  not_installed: 'github.statusNotInstalled',
  installing: 'github.statusInstalling',
}

const AUTH_STATUS_KEY: Record<AuthStatus, string> = {
  checking: 'github.authChecking',
  authenticated: 'github.authAuthenticated',
  not_authenticated: 'github.authNotAuthenticated',
}

// ── Reducer ────────────────────────────────────────────────────────────────────

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
    default: return state
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toStatusDot(status: ToolStatus): 'success' | 'failure' | 'pending' {
  if (status === 'installed') return 'success'
  if (status === 'not_installed') return 'failure'
  return 'pending'
}

function toAuthDot(status: AuthStatus): 'success' | 'failure' | 'pending' {
  if (status === 'authenticated') return 'success'
  if (status === 'not_authenticated') return 'failure'
  return 'pending'
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SettingsGitHub() {
  const { t } = useTranslation('settings')
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const [state, dispatch] = useReducer(reducer, {
    ghStatus: 'checking',
    authStatus: 'checking',
    showAuthDialog: false,
  })

  // Check if gh CLI is installed
  useEffect(() => {
    let cancelled = false
    shell
      .checkTool('gh')
      .then((ok: boolean) => { if (!cancelled) dispatch({ type: 'setGh', status: ok ? 'installed' : 'not_installed' }) })
      .catch(() => { if (!cancelled) dispatch({ type: 'setGh', status: 'not_installed' }) })
    return () => { cancelled = true }
  }, [])

  // Check auth status once gh is confirmed installed
  useEffect(() => {
    if (state.ghStatus !== 'installed') {
      dispatch({ type: 'setAuth', status: 'not_authenticated' })
      return
    }
    let cancelled = false
    dispatch({ type: 'setAuth', status: 'checking' })
    shell
      .checkGhAuth()
      .then((ok: boolean) => { if (!cancelled) dispatch({ type: 'setAuth', status: ok ? 'authenticated' : 'not_authenticated' }) })
      .catch(() => { if (!cancelled) dispatch({ type: 'setAuth', status: 'not_authenticated' }) })
    return () => { cancelled = true }
  }, [state.ghStatus])

  const handleInstall = useCallback(async () => {
    dispatch({ type: 'setGh', status: 'installing' })
    try { await shell.installTool('gh') } catch { /* recheck below */ }
    if (!mountedRef.current) return
    dispatch({ type: 'setGh', status: 'checking' })
    try {
      const ok = await shell.checkTool('gh')
      if (mountedRef.current) dispatch({ type: 'setGh', status: ok ? 'installed' : 'not_installed' })
    } catch {
      if (mountedRef.current) dispatch({ type: 'setGh', status: 'not_installed' })
    }
  }, [])

  const handleAuthSuccess = useCallback(() => {
    dispatch({ type: 'setAuth', status: 'authenticated' })
  }, [])

  const recheckAuth = useCallback(async () => {
    dispatch({ type: 'setAuth', status: 'checking' })
    try {
      const ok = await shell.checkGhAuth()
      if (mountedRef.current) dispatch({ type: 'setAuth', status: ok ? 'authenticated' : 'not_authenticated' })
    } catch {
      if (mountedRef.current) dispatch({ type: 'setAuth', status: 'not_authenticated' })
    }
  }, [])

  const openDocs = useCallback(() => shell.openExternal(GH_DOCS_URL), [])
  const openAuthDialog = useCallback(() => dispatch({ type: 'showAuth', show: true }), [])
  const closeAuthDialog = useCallback(() => dispatch({ type: 'showAuth', show: false }), [])

  return (
    <div className="settings-section">
      <span className="settings-hint">{t('github.description')}</span>

      <div className="settings-divider" />

      {/* ── GitHub CLI installation ───────────────────────────────────── */}
      <h4 className="settings-section-subtitle">{t('github.cliHeader')}</h4>
      <div className="settings-field settings-field--row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
          <StatusDot state={toStatusDot(state.ghStatus)} />
          <span className="settings-label">{t(GH_STATUS_KEY[state.ghStatus])}</span>
        </div>
        {state.ghStatus === 'not_installed' && (
          <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
            <Button size="sm" variant="primary" onClick={handleInstall}>
              {t('github.install')}
            </Button>
            <Button size="sm" onClick={openDocs}>
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
          <StatusDot state={toAuthDot(state.authStatus)} />
          <span className="settings-label">{t(AUTH_STATUS_KEY[state.authStatus])}</span>
        </div>
        {state.ghStatus === 'installed' && state.authStatus === 'not_authenticated' && (
          <Button size="sm" variant="primary" onClick={openAuthDialog}>
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
        onClose={closeAuthDialog}
        onSuccess={handleAuthSuccess}
      />
    </div>
  )
}
