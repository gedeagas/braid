/**
 * OfflineBanner - persistent banner shown when the app has no internet.
 *
 * Shows an amber warning bar at the top of the viewport. When connectivity
 * is restored, briefly shows "Back online" for 2s before sliding away.
 */

import { useReducer, useEffect } from 'react'
import { useOnlineStatus } from '@/lib/online'
import { useTranslation } from 'react-i18next'

type Phase = 'hidden' | 'offline' | 'reconnected' | 'dismissing'
type Action = { type: 'went_offline' } | { type: 'went_online' } | { type: 'dismiss' }

function reducer(state: Phase, action: Action): Phase {
  switch (action.type) {
    case 'went_offline': return 'offline'
    case 'went_online': return state === 'offline' ? 'reconnected' : state
    case 'dismiss': return 'dismissing'
    default: return state
  }
}

export function OfflineBanner() {
  const { t } = useTranslation('common')
  const online = useOnlineStatus()
  const [phase, dispatch] = useReducer(reducer, 'hidden')

  // Track online/offline transitions
  useEffect(() => {
    if (!online) {
      dispatch({ type: 'went_offline' })
    } else if (online) {
      dispatch({ type: 'went_online' })
    }
  }, [online])

  // Auto-dismiss after showing "reconnected" for 2s
  useEffect(() => {
    if (phase !== 'reconnected') return
    const timer = setTimeout(() => dispatch({ type: 'dismiss' }), 2000)
    return () => clearTimeout(timer)
  }, [phase])

  // Clean up dismissing state after animation completes
  useEffect(() => {
    if (phase !== 'dismissing') return
    const timer = setTimeout(() => dispatch({ type: 'dismiss' }), 300)
    return () => clearTimeout(timer)
  }, [phase])

  if (phase === 'hidden' || (phase === 'dismissing')) {
    // Render during dismissing for slide-up animation
    if (phase === 'dismissing') {
      return (
        <div className="offline-banner offline-banner--dismissing" role="status">
          <span className="offline-banner__icon">&#x2713;</span>
          <span className="offline-banner__text">{t('offline.reconnected')}</span>
        </div>
      )
    }
    return null
  }

  const isReconnected = phase === 'reconnected'

  return (
    <div
      className={`offline-banner${isReconnected ? ' offline-banner--reconnected' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="offline-banner__icon">{isReconnected ? '\u2713' : '\u26A0'}</span>
      <span className="offline-banner__text">
        {isReconnected ? t('offline.reconnected') : t('offline.banner')}
      </span>
    </div>
  )
}
