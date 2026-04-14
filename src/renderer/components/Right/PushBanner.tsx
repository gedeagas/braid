import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '@/lib/online'
import { Tooltip } from '@/components/shared/Tooltip'
import { PushErrorPanel } from './PushErrorPanel'

interface PushBannerProps {
  aheadCount: number
  upstream: string | null
  pushState: 'idle' | 'pushing' | 'success' | 'error'
  onPush: () => void
  errorMessage?: string | null
  onDismissError?: () => void
}

export function PushBanner({ aheadCount, upstream, pushState, onPush, errorMessage, onDismissError }: PushBannerProps) {
  const { t } = useTranslation('right')
  const online = useOnlineStatus()

  const pushLabel =
    pushState === 'pushing' ? t('pushing') :
    pushState === 'success' ? t('pushSuccess') :
    pushState === 'error'   ? t('pushError') :
                               t('push')

  const pushBtnClass =
    pushState === 'success' ? 'changes-push-btn changes-push-btn--success' :
    pushState === 'error'   ? 'changes-push-btn changes-push-btn--error' :
    pushState === 'pushing' ? 'changes-push-btn changes-push-btn--pushing' :
                               'changes-push-btn'

  return (
    <>
      <div className="changes-push-banner">
        <span className="changes-push-banner-text">
          {t('commitsAhead', { count: aheadCount, baseBranch: upstream ?? 'origin' })}
        </span>
        <Tooltip content={!online ? t('offlineDisabled') : ''} disabled={online}>
          <button
            className={pushBtnClass}
            onClick={onPush}
            disabled={!online || pushState !== 'idle'}
          >
            {pushLabel}
          </button>
        </Tooltip>
      </div>
      {errorMessage && onDismissError && (
        <PushErrorPanel message={errorMessage} onDismiss={onDismissError} />
      )}
    </>
  )
}
