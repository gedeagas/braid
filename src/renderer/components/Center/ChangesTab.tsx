import { Tooltip } from '@/components/shared/Tooltip'
import { IconDiff } from '@/components/shared/icons'

interface Props {
  tabKey: string
  label: string
  isActive: boolean
  isDragSource: boolean
  isDraggedOver: boolean
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

export function ChangesTab({
  tabKey, label, isActive, isDragSource, isDraggedOver,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  onActivate, onKeyDown, onContextMenu, onClose
}: Props) {
  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`tab tab-diff${isActive ? ' active' : ''}${isDraggedOver ? ' tab--drop-target' : ''}${isDragSource ? ' tab--dragging' : ''}`}
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
      <Tooltip content={label} position="bottom" delay={600}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <IconDiff size={12} />
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
