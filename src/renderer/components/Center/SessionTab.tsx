import type { RefObject } from 'react'
import { Tooltip } from '@/components/shared/Tooltip'
import type { AgentSession } from '@/types'

interface Props {
  session: AgentSession
  tabKey: string
  displayTitle: string
  isActive: boolean
  isEditing: boolean
  isDragSource: boolean
  isDraggedOver: boolean
  statusClass: string
  editValue: string
  inputRef: RefObject<HTMLInputElement | null>
  closeActiveSessionTitle: string
  closeActiveSessionMessageFn: (status: string) => string
  onDragStart: (k: string) => (e: React.DragEvent) => void
  onDragOver: (k: string) => (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (k: string) => (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
  onActivate: () => void
  onKeyDown: (e: React.KeyboardEvent, k: string) => void
  onContextMenu: (e: React.MouseEvent, k: string) => void
  onClose: () => void
  onStartEdit: (e: React.MouseEvent) => void
  onEditValueChange: (v: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
}

export function SessionTab({
  session, tabKey, displayTitle, isActive, isEditing, isDragSource, isDraggedOver,
  statusClass, editValue, inputRef,
  closeActiveSessionTitle, closeActiveSessionMessageFn,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  onActivate, onKeyDown, onContextMenu, onClose,
  onStartEdit, onEditValueChange, onCommitEdit, onCancelEdit
}: Props) {
  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`tab${isActive ? ' active' : ''}${isDraggedOver ? ' tab--drop-target' : ''}${isDragSource ? ' tab--dragging' : ''}${statusClass}`}
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
          placeholder={displayTitle}
          onChange={(e) => onEditValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onCommitEdit() }
            else if (e.key === 'Escape') { e.preventDefault(); onCancelEdit() }
          }}
          onBlur={onCommitEdit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Tooltip content={displayTitle} position="bottom" delay={600}>
          <span className="tab-text" onDoubleClick={onStartEdit}>
            {displayTitle}
          </span>
        </Tooltip>
      )}
      <span
        className="tab-close"
        aria-hidden="true"
        onClick={(e) => {
          e.stopPropagation()
          if (session.status !== 'idle' && session.status !== 'inactive') {
            const msg = `${closeActiveSessionTitle}\n\n${closeActiveSessionMessageFn(session.status)}`
            if (!window.confirm(msg)) return
          }
          onClose()
        }}
      >
        ×
      </span>
    </button>
  )
}
