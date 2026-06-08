import { memo, type RefObject } from 'react'
import { Tooltip } from '@/components/shared/Tooltip'
import { IconClose, IconPencil } from '@/components/shared/icons'
import type { TermTab, RenameState } from './terminalCache'

interface Props {
  tab: TermTab
  isActive: boolean
  isHovered: boolean
  renaming: RenameState | null
  renameInputRef: RefObject<HTMLInputElement | null>
  dragKey: string | null
  overKey: string | null
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onStartRename: (id: string, label: string, e: React.MouseEvent) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onSetRenaming: (state: RenameState) => void
  onHover: (id: string | null) => void
  onDragStart: (key: string) => (e: React.DragEvent) => void
  onDragOver: (key: string) => (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (key: string) => (e: React.DragEvent) => void
  onDragEnd: () => void
}

export const TerminalTabRow = memo(function TerminalTabRow({
  tab, isActive, isHovered, renaming, renameInputRef, dragKey, overKey,
  onSwitch, onClose, onStartRename, onCommitRename, onCancelRename,
  onSetRenaming, onHover, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}: Props) {
  const isRenaming = renaming?.tabId === tab.id
  const showActions = (isActive || isHovered) && !isRenaming
  const isDraggedOver = overKey === tab.id && dragKey !== tab.id
  const classes = [
    'terminal-tab',
    isActive ? 'terminal-tab--active' : '',
    isHovered ? 'terminal-tab--hovered' : '',
    isRenaming ? 'terminal-tab--renaming' : '',
    dragKey === tab.id ? 'terminal-tab--dragging' : '',
    isDraggedOver ? 'terminal-tab--drop-target' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      draggable={!isRenaming}
      onDragStart={onDragStart(tab.id)}
      onDragOver={onDragOver(tab.id)}
      onDragLeave={onDragLeave}
      onDrop={onDrop(tab.id)}
      onDragEnd={onDragEnd}
      onClick={() => !isRenaming && onSwitch(tab.id)}
      onDoubleClick={(e) => !isRenaming && onStartRename(tab.id, tab.label, e)}
      onMouseEnter={() => onHover(tab.id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="terminal-tab__prompt">
        {'›_'}
      </span>

      {isRenaming ? (
        <input
          ref={renameInputRef}
          className="terminal-tab__input"
          value={renaming!.draft}
          onChange={(e) => onSetRenaming({ tabId: tab.id, draft: e.target.value })}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename()
            else if (e.key === 'Escape') onCancelRename()
            e.stopPropagation()
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: Math.max(72, renaming!.draft.length * 8),
          }}
          autoFocus
        />
      ) : (
        <span className="terminal-tab__label">
          {tab.label}
        </span>
      )}

      {showActions && (
        <Tooltip content="Rename (or double-click)">
          <button
            type="button"
            className="terminal-tab__action"
            aria-label="Rename terminal tab"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => onStartRename(tab.id, tab.label, e)}
          >
            <IconPencil size={12} />
          </button>
        </Tooltip>
      )}

      {showActions && (
        <Tooltip content="Close">
          <button
            type="button"
            className="terminal-tab__action terminal-tab__action--danger"
            aria-label="Close terminal tab"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
          >
            <IconClose size={9} />
          </button>
        </Tooltip>
      )}
    </div>
  )
})
