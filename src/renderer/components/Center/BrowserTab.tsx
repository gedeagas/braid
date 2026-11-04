import { useState } from 'react'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconGlobe } from '@/components/shared/icons'
import { Spinner } from '@/components/ui'
import type { BrowserTab as BrowserTabType } from '@/store/ui'
import { hostLabel } from '@/lib/browser/omnibox'

interface Props {
  tab: BrowserTabType
  tabKey: string
  isActive: boolean
  isLoading: boolean
  isDragSource: boolean
  isDraggedOver: boolean
  newTabLabel: string
  onDragStart: (k: string) => (e: React.DragEvent) => void
  onDragOver: (k: string) => (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (k: string) => (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
  onActivate: () => void
  onKeyDown: (e: React.KeyboardEvent, k: string) => void
  onContextMenu: (e: React.MouseEvent, k: string) => void
  onClose: () => void
}

export function BrowserTab({
  tab, tabKey, isActive, isLoading, isDragSource, isDraggedOver, newTabLabel,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  onActivate, onKeyDown, onContextMenu, onClose,
}: Props) {
  // Remember favicons that failed to load so we fall back to the globe.
  const [brokenFavicon, setBrokenFavicon] = useState<string | null>(null)
  const label = tab.title || hostLabel(tab.url) || newTabLabel
  const showFavicon = tab.faviconUrl && tab.faviconUrl !== brokenFavicon

  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`tab tab-browser${isActive ? ' active' : ''}${isDraggedOver ? ' tab--drop-target' : ''}${isDragSource ? ' tab--dragging' : ''}`}
      draggable
      onDragStart={onDragStart(tabKey)}
      onDragOver={onDragOver(tabKey)}
      onDragLeave={onDragLeave}
      onDrop={onDrop(tabKey)}
      onDragEnd={onDragEnd}
      onClick={onActivate}
      onKeyDown={(e) => onKeyDown(e, tabKey)}
      onContextMenu={(e) => onContextMenu(e, tabKey)}
    >
      <Tooltip content={tab.url || label} position="bottom" delay={600}>
        <span className="tab-browser-label">
          <span className="tab-browser-icon">
            {isLoading ? <Spinner size="sm" />
              : showFavicon ? <img src={tab.faviconUrl} alt="" onError={() => setBrokenFavicon(tab.faviconUrl ?? null)} />
              : <IconGlobe size={12} />}
          </span>
          <span className="tab-text">{label}</span>
        </span>
      </Tooltip>
      <span
        className="tab-close"
        aria-hidden="true"
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >
        ×
      </span>
    </button>
  )
}
