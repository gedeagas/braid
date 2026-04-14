/**
 * NetworkErrorPrompt - shown in chat input when a network error occurs.
 *
 * Offers retry and dismiss actions, similar to AuthErrorPrompt.
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '@/lib/online'
import { IconGlobe } from '@/components/shared/icons'

interface Props {
  onRetry: () => void
  onDismiss: () => void
}

export function NetworkErrorPrompt({ onRetry, onDismiss }: Props) {
  const { t } = useTranslation('center')
  const promptRef = useRef<HTMLDivElement>(null)
  const online = useOnlineStatus()

  useEffect(() => {
    promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  return (
    <div className="auth-error-prompt" ref={promptRef}>
      <div className="auth-error-header">
        <IconGlobe size={11} className="auth-error-header-icon" />
        <span className="auth-error-header-text">{t('networkError')}</span>
      </div>

      <div className="auth-error-body">
        <p className="auth-error-message">{t('networkErrorMessage')}</p>
      </div>

      <div className="auth-error-actions">
        <button
          className="auth-error-retry-btn"
          onClick={onRetry}
          disabled={!online}
          title={!online ? t('offlineSendDisabled') : undefined}
        >
          {t('networkRetry')}
        </button>
        <button className="auth-error-dismiss-btn" onClick={onDismiss}>
          {t('authErrorDismiss')}
        </button>
      </div>
    </div>
  )
}
