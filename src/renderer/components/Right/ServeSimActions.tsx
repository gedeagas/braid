import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconArrowLeft, IconLink, IconRefresh, IconSliders, IconStop } from '@/components/shared/icons'

interface ServeSimActionsProps {
  deviceId: string
  framework?: 'react-native' | 'flutter' | null
  isLinked: boolean
  canLink: boolean
  onToggleLink: () => void
  onDisconnect: () => void
  onShutdown: () => void
}

interface IconActionProps {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}

function IconAction({ label, onClick, danger, children }: IconActionProps) {
  return (
    <Tooltip content={label} position="bottom">
      <button
        type="button"
        className={`serve-sim-bar-icon${danger ? ' serve-sim-bar-icon--danger' : ''}`}
        onClick={onClick}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  )
}

const run = (fn: () => Promise<unknown>) => () => {
  fn().catch((err) => console.error('[ServeSimActions] action failed:', err))
}

/**
 * serve-sim draws its own device header, bezel and controls, so in that mode
 * Braid's two-row header collapses into this single strip. It shares serve-sim's
 * page colour so the panel reads as one surface, and keeps only what serve-sim
 * lacks: back to the device list, chat link, framework reload, and shutdown.
 */
export const ServeSimActions = memo(function ServeSimActions({
  deviceId, framework, isLinked, canLink, onToggleLink, onDisconnect, onShutdown,
}: ServeSimActionsProps) {
  const { t } = useTranslation('right')
  const actions = useMemo(() => ({
    rnReload: run(() => ipc.simulator.metroReload()),
    rnDevMenu: run(() => ipc.simulator.sendKeyCombo(deviceId, 'ios', 'cmd+d')),
    flutterReload: run(() => ipc.simulator.flutterSignal('SIGUSR1')),
    flutterRestart: run(() => ipc.simulator.flutterSignal('SIGUSR2')),
  }), [deviceId])

  return (
    <div className="serve-sim-bar" role="toolbar" aria-label={t('simulatorActions')}>
      <IconAction label={t('simulatorDisconnect')} onClick={onDisconnect}>
        <IconArrowLeft size={14} />
      </IconAction>

      <Tooltip content={isLinked ? t('simulatorUnlinkChat') : t('simulatorLinkChat')} position="bottom" disabled={!canLink}>
        <button
          type="button"
          className={`serve-sim-bar-chip${isLinked ? ' serve-sim-bar-chip--linked' : ''}`}
          onClick={onToggleLink}
          disabled={!canLink}
          aria-pressed={isLinked}
        >
          {isLinked ? <span className="serve-sim-bar-dot" aria-hidden /> : <IconLink size={12} />}
          {isLinked ? t('simulatorLinked') : t('simulatorLinkChat')}
        </button>
      </Tooltip>

      <div className="serve-sim-bar-spacer" />

      {framework === 'react-native' && (
        <div className="serve-sim-bar-group">
          <span className="serve-sim-bar-label">{t('frameworkReactNative')}</span>
          <IconAction label={t('frameworkReload')} onClick={actions.rnReload}>
            <IconRefresh size={14} />
          </IconAction>
          <IconAction label={t('frameworkDevMenu')} onClick={actions.rnDevMenu}>
            <IconSliders size={14} />
          </IconAction>
        </div>
      )}
      {framework === 'flutter' && (
        <div className="serve-sim-bar-group">
          <span className="serve-sim-bar-label">{t('frameworkFlutter')}</span>
          <IconAction label={t('frameworkHotReload')} onClick={actions.flutterReload}>
            <IconRefresh size={14} />
          </IconAction>
          <IconAction label={t('frameworkHotRestart')} onClick={actions.flutterRestart}>
            <IconSliders size={14} />
          </IconAction>
        </div>
      )}

      <IconAction label={t('simulatorShutdown')} onClick={onShutdown} danger>
        <IconStop size={14} />
      </IconAction>
    </div>
  )
})
