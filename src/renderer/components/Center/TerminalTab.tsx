import type { RefObject } from 'react'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconTerminal } from '@/components/shared/icons'
import type { BigTerminalTab as BigTerminalTabType } from '@/store/ui/terminals'

interface Props {
  tab: BigTerminalTabType
  tabKey: string
  isActive: boolean
  isEditing: boolean
  isDragSource: boolean
  isDraggedOver: boolean
  editValue: string
  inputRef: RefObject<HTMLInputElement | null>
  onDragStart: (k: string) => (e: React.DragEvent) => void
  onDragOver: (k: string) => (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (k: string) => (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
  onActivate: () => void
  onKeyDown: (e: React.KeyboardEvent, k: string) => void
  onContextMenu: (e: React.MouseEvent, k: string) => void
  onClose: () => void
  onStartEdit: () => void
  onEditValueChange: (v: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
}

export function TerminalTab({
  tab, tabKey, isActive, isEditing, isDragSource, isDraggedOver,
  editValue, inputRef,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  onActivate, onKeyDown, onContextMenu, onClose,
  onStartEdit, onEditValueChange, onCommitEdit, onCancelEdit
}: Props) {
  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`tab tab-terminal${isActive ? ' active' : ''}${isDraggedOver ? ' tab--drop-target' : ''}${isDragSource ? ' tab--dragging' : ''}`}
      draggable={!isEditing}
      onDragStart={onDragStart(tabKey)}
      onDragOver={onDragOver(tabKey)}
      onDragLeave={onDragLeave}
      onDrop={onDrop(tabKey)}
      onDragEnd={onDragEnd}
      onClick={() => !isEditing && onActivate()}
      onKeyDown={(e) => onKeyDown(e, tabKey)}
      onContextMenu={(e) => onContextMenu(e, tabKey)}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          className="tab-rename-input"
          value={editValue}
          placeholder={tab.label}
          onChange={(e) => onEditValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onCommitEdit() }
            else if (e.key === 'Escape') { e.preventDefault(); onCancelEdit() }
          }}
          onBlur={onCommitEdit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Tooltip content={tab.label} position="bottom" delay={600}>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-4)' }}
            onDoubleClick={(e) => { e.stopPropagation(); onStartEdit() }}
          >
            <IconTerminal size={12} />
            <span className="tab-text">{tab.label}</span>
          </span>
        </Tooltip>
      )}
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
