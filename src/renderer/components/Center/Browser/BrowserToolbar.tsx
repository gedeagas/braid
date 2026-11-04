import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/shared/Tooltip'
import { ContextMenu, type ContextMenuItem } from '@/components/shared/ContextMenu'
import { IconArrowLeft, IconArrowRight, IconClose, IconCodeBrackets, IconExternalLink, IconRefresh } from '@/components/shared/icons'
import { Button } from '@/components/ui'
import { runBrowserAction } from '@/lib/browser/browserCommands'
import * as ipc from '@/lib/ipc'
import { BrowserOmnibox } from './BrowserOmnibox'
import { DesignModeToggle, ProfilePicker, ViewportControl } from './BrowserToolbarExtras'
import type { BrowserViewport } from '@shared/browser'

interface Props {
  tabId: string
  worktreeId: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  autoFocusAddress: boolean
  onNavigate: (url: string) => void
  onStop: () => void
  onFocusPage: () => void
  profileId: string
  onProfileChange: (profileId: string) => void
  viewport: BrowserViewport | undefined
  onViewportChange: (viewport: BrowserViewport | undefined) => void
  designActive: boolean
  onToggleDesign: () => void
}

export const BrowserToolbar = memo(function BrowserToolbar({
  tabId, worktreeId, url, loading, canGoBack, canGoForward, autoFocusAddress, onNavigate, onStop, onFocusPage,
  profileId, onProfileChange, viewport, onViewportChange, designActive, onToggleDesign,
}: Props) {
  const { t } = useTranslation('center')
  const [reloadMenu, setReloadMenu] = useState<{ x: number; y: number } | null>(null)
  const hasPage = Boolean(url) && url !== 'about:blank'

  const reloadItems = useMemo((): ContextMenuItem[] => [
    { label: `${t('browser.reload')}  ⌘R`, onClick: () => runBrowserAction(tabId, 'reload') },
    { label: `${t('browser.hardReload')}  ⌘⇧R`, onClick: () => runBrowserAction(tabId, 'hardReload') },
  ], [t, tabId])

  const openReloadMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setReloadMenu({ x: e.clientX, y: e.clientY })
  }, [])

  return (
    <div className="browser-toolbar">
      <Tooltip content={t('browser.back')} shortcut={'⌘['} position="bottom">
        <Button size="icon" className="browser-icon-btn" aria-label={t('browser.back')} disabled={!canGoBack} onClick={() => runBrowserAction(tabId, 'back')}>
          <IconArrowLeft size={14} />
        </Button>
      </Tooltip>
      <Tooltip content={t('browser.forward')} shortcut={'⌘]'} position="bottom">
        <Button size="icon" className="browser-icon-btn" aria-label={t('browser.forward')} disabled={!canGoForward} onClick={() => runBrowserAction(tabId, 'forward')}>
          <IconArrowRight size={14} />
        </Button>
      </Tooltip>
      {loading ? (
        <Tooltip content={t('browser.stop')} position="bottom">
          <Button size="icon" className="browser-icon-btn" aria-label={t('browser.stop')} onClick={onStop}>
            <IconClose size={12} />
          </Button>
        </Tooltip>
      ) : (
        <Tooltip content={`${t('browser.reload')} · ${t('browser.reloadHint')}`} shortcut={'⌘R'} position="bottom">
          <Button
            size="icon"
            className="browser-icon-btn"
            aria-label={t('browser.reload')}
            disabled={!hasPage}
            onClick={() => runBrowserAction(tabId, 'reload')}
            onContextMenu={openReloadMenu}
          >
            <IconRefresh size={13} />
          </Button>
        </Tooltip>
      )}

      <BrowserOmnibox
        tabId={tabId}
        worktreeId={worktreeId}
        url={url}
        autoFocus={autoFocusAddress}
        onNavigate={onNavigate}
        onDone={onFocusPage}
      />

      <ProfilePicker profileId={profileId} onChange={onProfileChange} />
      <DesignModeToggle active={designActive} disabled={!hasPage} onToggle={onToggleDesign} />
      <ViewportControl viewport={viewport} disabled={!hasPage} onChange={onViewportChange} />
      <Tooltip content={t('browser.openInSystemBrowser')} position="bottom">
        <Button size="icon" className="browser-icon-btn" aria-label={t('browser.openInSystemBrowser')} disabled={!hasPage} onClick={() => ipc.shell.openExternal(url)}>
          <IconExternalLink size={13} />
        </Button>
      </Tooltip>
      <Tooltip content={t('browser.devtools')} shortcut={'⌘⌥I'} position="bottom">
        <Button size="icon" className="browser-icon-btn" aria-label={t('browser.devtools')} disabled={!hasPage} onClick={() => runBrowserAction(tabId, 'devtools')}>
          <IconCodeBrackets size={13} />
        </Button>
      </Tooltip>

      {reloadMenu && (
        <ContextMenu x={reloadMenu.x} y={reloadMenu.y} items={reloadItems} onClose={() => setReloadMenu(null)} />
      )}
    </div>
  )
})
