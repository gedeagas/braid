import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { IconSliders } from '@/components/shared/icons'

interface ServeSimActionsProps {
  deviceId: string
  deviceName: string
  framework?: 'react-native' | 'flutter' | null
  isLinked: boolean
  canLink: boolean
  onToggleLink: () => void
  onDisconnect: () => void
  onShutdown: () => void
}

/**
 * serve-sim draws its own header, bezel and device controls, so Braid's header
 * and framework toolbar are hidden in that mode. The Braid-only actions (chat
 * link, framework reload, disconnect/shutdown) live behind this floating button.
 */
export const ServeSimActions = memo(function ServeSimActions({
  deviceId, deviceName, framework, isLinked, canLink, onToggleLink, onDisconnect, onShutdown,
}: ServeSimActionsProps) {
  const { t } = useTranslation('right')
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenuAt(null), [])

  const openMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMenuAt((open) => (open ? null : { x: rect.left, y: rect.bottom + 4 }))
  }, [])

  const items = useMemo<ContextMenuItem[]>(() => {
    const run = (fn: () => Promise<unknown>) => () => {
      fn().catch((err) => console.error('[ServeSimActions] action failed:', err))
    }
    const frameworkItems: ContextMenuItem[] =
      framework === 'react-native' ? [
        { label: t('frameworkReload'), onClick: run(() => ipc.simulator.metroReload()) },
        { label: t('frameworkDevMenu'), onClick: run(() => ipc.simulator.sendKeyCombo(deviceId, 'ios', 'cmd+d')) },
        { label: '---', onClick: () => {} },
      ] : framework === 'flutter' ? [
        { label: t('frameworkHotReload'), onClick: run(() => ipc.simulator.flutterSignal('SIGUSR1')) },
        { label: t('frameworkHotRestart'), onClick: run(() => ipc.simulator.flutterSignal('SIGUSR2')) },
        { label: '---', onClick: () => {} },
      ] : []
    return [
      { label: isLinked ? t('simulatorUnlinkChat') : t('simulatorLinkChat'), disabled: !canLink, onClick: onToggleLink },
      { label: '---', onClick: () => {} },
      ...frameworkItems,
      { label: t('simulatorDisconnect'), onClick: onDisconnect },
      { label: t('simulatorShutdown'), danger: true, onClick: onShutdown },
    ]
  }, [t, framework, deviceId, isLinked, canLink, onToggleLink, onDisconnect, onShutdown])

  return (
    <>
      <button
        type="button"
        className={`simulator-serve-sim-actions${isLinked ? ' simulator-serve-sim-actions--linked' : ''}`}
        onClick={openMenu}
        // Keep ContextMenu's outside-click handler from closing it just before this click reopens it
        onMouseDown={menuAt ? (e) => e.stopPropagation() : undefined}
        title={`${deviceName} - ${t('simulatorActions')}`}
        aria-label={t('simulatorActions')}
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
      >
        <IconSliders size={14} />
      </button>
      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          items={items.map((item) => ({ ...item, onClick: () => { closeMenu(); item.onClick() } }))}
          onClose={closeMenu}
        />
      )}
    </>
  )
})
