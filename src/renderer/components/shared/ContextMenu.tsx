import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  /** Use '---' as the label to render a separator line */
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Dismiss on click-outside or Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Clamp to viewport after layout so the menu never overflows the screen
  useLayoutEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      ref.current.style.left = `${x - rect.width}px`
    }
    if (rect.bottom > window.innerHeight) {
      ref.current.style.top = `${y - rect.height}px`
    }
  }, [x, y])

  return createPortal(
    <div ref={ref} className="context-menu" style={{ left: x, top: y }}>
      {items.map((item, i) =>
        item.label === '---' ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            className={[
              'context-menu-item',
              item.danger ? 'danger' : '',
              item.disabled ? 'disabled' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              if (!item.disabled) {
                item.onClick()
                onClose()
              }
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
