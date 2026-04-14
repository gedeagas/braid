import { memo, type RefObject } from 'react'
import { Tooltip } from '@/components/shared/Tooltip'
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

  return (
    <div
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
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px 0 12px',
        height: 36,
        fontSize: 13,
        cursor: isRenaming ? 'default' : dragKey === tab.id ? 'grabbing' : 'grab',
        whiteSpace: 'nowrap',
        borderRight: '1px solid var(--border)',
        background: isActive ? 'var(--bg-primary)' : isHovered ? 'var(--bg-tertiary)' : 'transparent',
        color: isActive ? 'var(--text-primary)' : isHovered ? 'var(--text-secondary)' : 'var(--text-muted)',
        boxShadow: isActive
          ? 'inset 0 -2px 0 var(--accent)'
          : isDraggedOver
            ? 'inset 2px 0 0 var(--accent)'
            : 'none',
        opacity: dragKey === tab.id ? 0.4 : 1,
        userSelect: 'none',
        transition: 'background 0.1s, color 0.1s, opacity 0.15s',
      }}
    >
      {/* Shell prompt icon */}
      <span style={{ fontSize: 13, opacity: 0.6, fontFamily: 'monospace', letterSpacing: '-1px' }}>
        {'›_'}
      </span>

      {/* Label / inline rename input */}
      {isRenaming ? (
        <input
          ref={renameInputRef}
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
            background: 'var(--bg-primary)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            fontSize: 13,
            padding: '2px 7px',
            outline: 'none',
            boxShadow: '0 0 0 3px var(--accent-tint-15)',
            width: Math.max(72, renaming!.draft.length * 8),
            minWidth: 72,
            maxWidth: 200,
          }}
          autoFocus
        />
      ) : (
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tab.label}
        </span>
      )}

      {/* ✎ Rename button */}
      {showActions && (
        <Tooltip content="Rename (or double-click)">
          <span
            onClick={(e) => onStartRename(tab.id, tab.label, e)}
            style={{
              fontSize: 13, lineHeight: 1, cursor: 'pointer',
              padding: '3px 4px', borderRadius: 3, opacity: 0.35,
              flexShrink: 0, transition: 'opacity 0.1s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.35')}
          >
            ✎
          </span>
        </Tooltip>
      )}

      {/* ✕ Close button */}
      {showActions && (
        <Tooltip content="Close">
          <span
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
            style={{
              fontSize: 13, lineHeight: 1, cursor: 'pointer',
              padding: '3px 5px', borderRadius: 3,
              opacity: isActive ? 0.5 : 0.35,
              flexShrink: 0, transition: 'opacity 0.1s, background 0.1s, color 0.1s',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.opacity = '1'
              el.style.background = 'var(--red-tint-20)'
              el.style.color = 'var(--red)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.opacity = isActive ? '0.5' : '0.35'
              el.style.background = 'transparent'
              el.style.color = 'inherit'
            }}
          >
            ✕
          </span>
        </Tooltip>
      )}
    </div>
  )
})
