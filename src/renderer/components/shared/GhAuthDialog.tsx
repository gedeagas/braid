import { useEffect, useReducer, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { IconCopy, IconCheckmark, IconExternalLink } from '@/components/shared/icons'
import { github, shell } from '@/lib/ipc'
import { flash } from '@/store/flash'

// ── State ────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'requesting' | 'waiting' | 'feeding' | 'success' | 'error' | 'expired'

interface State {
  phase: Phase
  userCode: string
  verificationUri: string
  copied: boolean
  error: string
}

type Action =
  | { type: 'start_request' }
  | { type: 'code_received'; userCode: string; verificationUri: string }
  | { type: 'set_copied' }
  | { type: 'feeding_token' }
  | { type: 'auth_success' }
  | { type: 'auth_expired' }
  | { type: 'auth_error'; error: string }
  | { type: 'reset' }

const initialState: State = {
  phase: 'idle',
  userCode: '',
  verificationUri: '',
  copied: false,
  error: '',
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start_request':
      return { ...initialState, phase: 'requesting' }
    case 'code_received':
      return { ...state, phase: 'waiting', userCode: action.userCode, verificationUri: action.verificationUri }
    case 'set_copied':
      return { ...state, copied: true }
    case 'feeding_token':
      return { ...state, phase: 'feeding' }
    case 'auth_success':
      return { ...state, phase: 'success' }
    case 'auth_expired':
      return { ...state, phase: 'expired', error: '' }
    case 'auth_error':
      return { ...state, phase: 'error', error: action.error }
    case 'reset':
      return initialState
    default:
      return state
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface GhAuthDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function GhAuthDialog({ isOpen, onClose, onSuccess }: GhAuthDialogProps) {
  const { t } = useTranslation('common')
  const [state, dispatch] = useReducer(reducer, initialState)
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Start the device flow when dialog opens
  const startFlow = useCallback(async () => {
    dispatch({ type: 'start_request' })
    try {
      const { userCode, verificationUri } = await github.startDeviceFlow()
      dispatch({ type: 'code_received', userCode, verificationUri })
      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(userCode)
        dispatch({ type: 'set_copied' })
      } catch { /* clipboard may not be available */ }
    } catch (err) {
      dispatch({ type: 'auth_error', error: err instanceof Error ? err.message : 'Failed to start auth flow' })
    }
  }, [])

  useEffect(() => {
    if (isOpen) startFlow()
    else dispatch({ type: 'reset' })
  }, [isOpen, startFlow])

  // Listen for device flow events from main process
  useEffect(() => {
    if (!isOpen) return
    const cleanup = github.onDeviceFlowEvent(async (event) => {
      if (event.status === 'success' && event.token) {
        dispatch({ type: 'feeding_token' })
        const { success } = await github.feedGhToken(event.token)
        if (success) {
          dispatch({ type: 'auth_success' })
          flash('success', t('ghAuth.success'))
          setTimeout(() => {
            onSuccessRef.current?.()
            onCloseRef.current()
          }, 1200)
        } else {
          dispatch({ type: 'auth_error', error: 'Failed to configure GitHub CLI' })
        }
      } else if (event.status === 'expired') {
        dispatch({ type: 'auth_expired' })
      } else if (event.status === 'error') {
        dispatch({ type: 'auth_error', error: event.error || 'Unknown error' })
      }
    })
    return cleanup
  }, [isOpen, t])

  // Cancel polling on close
  const handleClose = useCallback(() => {
    github.cancelDeviceFlow()
    onClose()
  }, [onClose])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(state.userCode)
      dispatch({ type: 'set_copied' })
    } catch { /* ignore */ }
  }, [state.userCode])

  const handleOpenBrowser = useCallback(() => {
    shell.openExternal(state.verificationUri || 'https://github.com/login/device')
  }, [state.verificationUri])

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={t('ghAuth.title')} width="420px">
      {(state.phase === 'requesting' || state.phase === 'idle') && (
        <div className="gh-auth-status">
          <Spinner size="sm" />
        </div>
      )}

      {(state.phase === 'waiting' || state.phase === 'feeding') && (
        <>
          <p className="gh-auth-instruction">{t('ghAuth.instruction')}</p>
          <div className="gh-auth-code-box">
            <code className="gh-auth-code">{state.userCode}</code>
            <button className="gh-auth-code-copy" onClick={handleCopy} title={t('copy')}>
              {state.copied ? <IconCheckmark size={16} /> : <IconCopy size={16} />}
            </button>
          </div>
          <div className="gh-auth-status">
            <Spinner size="sm" />
            <span>{state.phase === 'feeding' ? t('ghAuth.configuring') : t('ghAuth.polling')}</span>
          </div>
          <div className="gh-auth-actions">
            <Button variant="primary" size="sm" onClick={handleOpenBrowser}>
              <IconExternalLink size={12} /> {t('ghAuth.openGitHub')}
            </Button>
          </div>
        </>
      )}

      {state.phase === 'success' && (
        <div className="gh-auth-result gh-auth-result--success">
          <IconCheckmark size={28} />
          <p>{t('ghAuth.success')}</p>
        </div>
      )}

      {state.phase === 'expired' && (
        <div className="gh-auth-result gh-auth-result--error">
          <p>{t('ghAuth.expired')}</p>
          <Button size="sm" onClick={startFlow}>{t('ghAuth.retry')}</Button>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="gh-auth-result gh-auth-result--error">
          <p>{state.error || t('ghAuth.error')}</p>
          <Button size="sm" onClick={startFlow}>{t('ghAuth.retry')}</Button>
        </div>
      )}
    </Dialog>
  )
}
