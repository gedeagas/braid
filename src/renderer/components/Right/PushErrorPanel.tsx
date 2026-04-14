import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { IconXCircle, IconClose, IconCopy } from '@/components/shared/icons'

interface PushErrorPanelProps {
  message: string
  onDismiss: () => void
}

export function PushErrorPanel({ message, onDismiss }: PushErrorPanelProps) {
  const { t } = useTranslation('right')
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [message])

  return (
    <div className="push-error-panel">
      <div className="push-error-panel-header">
        <span className="push-error-panel-title">
          <IconXCircle size={12} />
          {t('pushErrorHeading')}
        </span>
        <div className="push-error-panel-actions">
          <button className="push-error-panel-btn" onClick={handleCopy} title={t('pushErrorCopy')}>
            <IconCopy size={12} />
            {copied ? t('pushErrorCopied') : t('pushErrorCopy')}
          </button>
          <button className="push-error-panel-btn push-error-panel-btn--dismiss" onClick={onDismiss} title={t('pushErrorDismiss')}>
            <IconClose size={10} />
          </button>
        </div>
      </div>
      <pre className="push-error-panel-body">{message}</pre>
    </div>
  )
}
