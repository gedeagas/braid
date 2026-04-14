import { memo, useState, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { AppFavicon } from '@/components/shared/AppFavicon'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { Tooltip } from '@/components/shared/Tooltip'
import { useTabReorder } from '@/hooks/useTabReorder'
import type { EmbeddedApp } from '@/types'

interface AppItemProps {
  app: EmbeddedApp
  isActive: boolean
  isDormant: boolean
  isDragging: boolean
  isDragOver: boolean
  badge: number
  onToggle: (id: string) => void
  onQuit: (id: string) => void
  onHide: (id: string) => void
  onRemove: (id: string) => void
  dragHandlers: {
    onDragStart: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
}

function ActivityBarAppItem({
  app, isActive, isDormant, isDragging, isDragOver, badge,
  onToggle, onQuit, onHide, onRemove, dragHandlers,
}: AppItemProps) {
  const { t } = useTranslation('sidebar')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const menuItems: ContextMenuItem[] = [
    {
      label: isDormant ? t('appRelaunch') : t('appQuit'),
      onClick: () => isDormant ? onToggle(app.id) : onQuit(app.id),
    },
    { label: t('appHideFromDock'), onClick: () => onHide(app.id) },
    { label: '---', onClick: () => {} },
    { label: t('appRemove'), danger: true, onClick: () => onRemove(app.id) },
  ]

  const effectiveActive = isActive && !isDormant

  return (
    <>
      <Tooltip content={isDormant ? t('appDormant', { name: app.name }) : app.name} position="right">
        <button
          className={[
            'activity-bar-item',
            effectiveActive ? 'activity-bar-item--active' : '',
            isDormant ? 'activity-bar-app--dormant' : '',
            isDragging ? 'activity-bar-app--dragging' : '',
            isDragOver ? 'activity-bar-app--drag-over' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onToggle(app.id)}
          onContextMenu={handleContextMenu}
          draggable
          aria-label={isDormant ? t('appDormant', { name: app.name }) : app.name}
          {...dragHandlers}
        >
          <span className="app-favicon-active-ring">
            <AppFavicon url={app.url} name={app.name} size={20} />
          </span>
          {badge !== 0 && (
            <span className="activity-bar-app-badge" aria-label={t('appBadgeUnread', { count: badge })}>
              {badge > 0 ? badge : ''}
            </span>
          )}
        </button>
      </Tooltip>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

export const ActivityBarApps = memo(function ActivityBarApps() {
  const embeddedApps = useUIStore(useShallow((s) => s.embeddedApps))
  const activeWebAppId = useUIStore((s) => s.activeWebAppId)
  const dormantAppIds = useUIStore((s) => s.dormantAppIds)
  const webAppBadges = useUIStore((s) => s.webAppBadges)
  const toggleWebApp = useUIStore((s) => s.toggleWebApp)
  const quitWebApp = useUIStore((s) => s.quitWebApp)
  const hideWebApp = useUIStore((s) => s.hideWebApp)
  const removeEmbeddedApp = useUIStore((s) => s.removeEmbeddedApp)
  const reorderEmbeddedApps = useUIStore((s) => s.reorderEmbeddedApps)

  // Pass full embeddedApps IDs (not just visible) so reorder indices map correctly
  const appIds = useMemo(() => embeddedApps.map((a) => a.id), [embeddedApps])
  const { dragKey, overKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } =
    useTabReorder(appIds, reorderEmbeddedApps)

  const visibleApps = embeddedApps.filter((a) => a.visible)
  if (visibleApps.length === 0) return null

  return (
    <>
      <div className="activity-bar-divider" />
      {visibleApps.map((app) => (
        <ActivityBarAppItem
          key={app.id}
          app={app}
          isActive={activeWebAppId === app.id}
          isDormant={dormantAppIds.has(app.id)}
          isDragging={dragKey === app.id}
          isDragOver={overKey === app.id}
          badge={webAppBadges.get(app.id) ?? 0}
          onToggle={toggleWebApp}
          onQuit={quitWebApp}
          onHide={hideWebApp}
          onRemove={removeEmbeddedApp}
          dragHandlers={{
            onDragStart: onDragStart(app.id),
            onDragOver: onDragOver(app.id),
            onDragLeave,
            onDrop: onDrop(app.id),
            onDragEnd,
          }}
        />
      ))}
    </>
  )
})
