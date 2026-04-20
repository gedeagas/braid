import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { useUpdaterStore } from '@/store/updater'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconGitBranch, IconGrid, IconSettings, IconArrowUp } from '@/components/shared/icons'
import { ActivityBarApps } from './ActivityBarApps'

interface ActivityBarItemProps {
  icon: React.ReactNode
  label: string
  isActive: boolean
  onClick: () => void
  dataTour?: string
}

function ActivityBarItem({ icon, label, isActive, onClick, dataTour }: ActivityBarItemProps) {
  return (
    <Tooltip content={label} position="right">
      <button
        className={`activity-bar-item${isActive ? ' activity-bar-item--active' : ''}`}
        onClick={onClick}
        aria-label={label}
        data-tour={dataTour}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

export const ActivityBar = memo(function ActivityBar() {
  const { t } = useTranslation('sidebar')
  const { t: tMc } = useTranslation('missionControl')
  const sidebarPanelOpen = useUIStore((s) => s.sidebarPanelOpen)
  const missionControlActive = useUIStore((s) => s.missionControlActive)
  const webAppsEnabled = useUIStore((s) => s.webAppsEnabled)
  const activeWebAppId = useUIStore((s) => s.activeWebAppId)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleMissionControl = useUIStore((s) => s.toggleMissionControl)
  const openSettings = useUIStore((s) => s.openSettings)
  const updaterState = useUpdaterStore((s) => s.state)
  const updaterDispatch = useUpdaterStore((s) => s.dispatch)

  const dismissedUpdate =
    (updaterState.status === 'available' || updaterState.status === 'ready') &&
    updaterState.dismissed

  const updateTooltip = dismissedUpdate
    ? updaterState.status === 'ready'
      ? t('updateReady', { version: updaterState.version })
      : t('updateAvailable', { version: updaterState.version })
    : ''

  return (
    <div className="activity-bar">
      <div className="activity-bar-drag-region" />
      <div className="activity-bar-top">
        <ActivityBarItem
          icon={<IconGitBranch size={22} />}
          label={`${t('explorer')} (\u2318B)`}
          isActive={sidebarPanelOpen && !missionControlActive && !activeWebAppId}
          onClick={toggleSidebar}
        />
        <ActivityBarItem
          icon={<IconGrid size={20} />}
          label={`${tMc('sidebarButton')} (\u2318\u21E7M)`}
          isActive={missionControlActive}
          onClick={toggleMissionControl}
          dataTour="mission-control"
        />
        {webAppsEnabled && <ActivityBarApps />}
        <div className="activity-bar-drag-spacer" />
      </div>
      <div className="activity-bar-bottom">
        {dismissedUpdate && (
          <Tooltip content={updateTooltip} position="right">
            <button
              className="activity-bar-item activity-bar-update-btn"
              onClick={() => updaterDispatch({ type: 'undismiss' })}
              aria-label={updateTooltip}
            >
              <IconArrowUp size={18} />
              <span className="activity-bar-update-dot" />
            </button>
          </Tooltip>
        )}
        <ActivityBarItem
          icon={<IconSettings size={20} />}
          label={`${t('settings')} (\u2318,)`}
          isActive={false}
          onClick={() => openSettings()}
        />
      </div>
    </div>
  )
})
