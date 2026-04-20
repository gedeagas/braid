import { FileIcon } from '@react-symbols/icons/utils'
import { Tooltip } from '@/components/shared/Tooltip'

interface Props {
  filePath: string
  tabKey: string
  isActive: boolean
  isDirty: boolean
  isDragSource: boolean
  isDraggedOver: boolean
  unsavedLabel: string
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

export function FileTab({
  filePath, tabKey, isActive, isDirty, isDragSource, isDraggedOver, unsavedLabel,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  onActivate, onKeyDown, onContextMenu, onClose
}: Props) {
  const name = filePath.split('/').pop() ?? filePath
  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`tab tab-file${isActive ? ' active' : ''}${isDraggedOver ? ' tab--drop-target' : ''}${isDragSource ? ' tab--dragging' : ''}`}
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
      <Tooltip content={filePath} position="bottom" delay={600}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'inherit' }}>
          <span className="tab-file-icon">
            <FileIcon fileName={name} autoAssign width={14} height={14} />
          </span>
          <span className="tab-text">{name}</span>
        </span>
      </Tooltip>
      {isDirty && <span className="tab-dirty" aria-label={unsavedLabel}>●</span>}
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
