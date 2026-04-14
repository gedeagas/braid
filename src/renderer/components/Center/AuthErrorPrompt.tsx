import { useEffect, useRef, useReducer, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingAuthError } from '@/types'
import { useUIStore } from '@/store/ui'
import { IconLock } from '@/components/shared/icons'
import * as ipc from '@/lib/ipc'

interface Props {
  pendingAuthError: PendingAuthError
  onRetry: () => void
  onDismiss: () => void
}

type ReAuthStatus = 'idle' | 'running' | 'success' | 'failed'
type State = { reAuthStatus: ReAuthStatus }
type Action = { type: 'START' } | { type: 'SUCCESS' } | { type: 'FAILED' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START': return { reAuthStatus: 'running' }
    case 'SUCCESS': return { reAuthStatus: 'success' }
    case 'FAILED': return { reAuthStatus: 'failed' }
  }
}

export function AuthErrorPrompt({ pendingAuthError, onRetry, onDismiss }: Props) {
  const { t } = useTranslation('center')
  const promptRef = useRef<HTMLDivElement>(null)
  const [state, dispatch] = useReducer(reducer, { reAuthStatus: 'idle' })

  useEffect(() => {
    promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const { authType } = pendingAuthError
  const showReAuth = authType === 'oauth' || authType === 'unknown'
  const showOpenSettings = authType === 'api_key' || authType === 'unknown'

  const messageKey =
    authType === 'oauth' ? 'authErrorMessageOauth' :
    authType === 'api_key' ? 'authErrorMessageApiKey' :
    'authErrorMessageUnknown'

  const handleReAuth = useCallback(async () => {
    dispatch({ type: 'START' })
    try {
      const result = await ipc.agent.reAuth()
      dispatch({ type: result.success ? 'SUCCESS' : 'FAILED' })
    } catch {
      dispatch({ type: 'FAILED' })
    }
  }, [])

  const handleOpenSettings = useCallback(() => {
    useUIStore.getState().openSettings('ai')
  }, [])

  const reAuthLabel =
    state.reAuthStatus === 'running' ? t('authErrorReAuthRunning') :
    state.reAuthStatus === 'success' ? t('authErrorSuccess') :
    state.reAuthStatus === 'failed' ? t('authErrorFailed') :
    t('authErrorReAuth')

  return (
    <div className="auth-error-prompt" ref={promptRef}>
      <div className="auth-error-header">
        <IconLock size={11} className="auth-error-header-icon" />
        <span className="auth-error-header-text">{t('authErrorTitle')}</span>
      </div>

      <div className="auth-error-body">
        <p className="auth-error-message">{t(messageKey)}</p>
      </div>

      <div className="auth-error-actions">
        {showReAuth && (
          <button
            className="auth-error-reauth-btn"
            onClick={handleReAuth}
            disabled={state.reAuthStatus === 'running'}
          >
            {reAuthLabel}
          </button>
        )}
        {showOpenSettings && (
          <button className="auth-error-settings-btn" onClick={handleOpenSettings}>
            {t('authErrorOpenSettings')}
          </button>
        )}
        {state.reAuthStatus === 'success' && (
          <button className="auth-error-retry-btn" onClick={onRetry}>
            {t('authErrorRetry')}
          </button>
        )}
        <button className="auth-error-dismiss-btn" onClick={onDismiss}>
          {t('authErrorDismiss')}
        </button>
      </div>
    </div>
  )
}
