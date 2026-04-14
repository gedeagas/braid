import { useCallback, useRef } from 'react'

interface Props {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  onResizeEnd?: () => void
}

export function ResizeHandle({ direction, onResize, onResizeEnd }: Props) {
  const startPos = useRef(0)
  const rafId = useRef(0)
  const pendingDelta = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
      pendingDelta.current = 0
      document.body.classList.add('resizing')

      const handleMouseMove = (e: MouseEvent) => {
        const current = direction === 'horizontal' ? e.clientX : e.clientY
        pendingDelta.current += current - startPos.current
        startPos.current = current

        if (!rafId.current) {
          rafId.current = requestAnimationFrame(() => {
            rafId.current = 0
            const delta = pendingDelta.current
            pendingDelta.current = 0
            onResize(delta)
          })
        }
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        if (rafId.current) {
          cancelAnimationFrame(rafId.current)
          rafId.current = 0
        }
        // Flush any remaining delta
        if (pendingDelta.current !== 0) {
          onResize(pendingDelta.current)
          pendingDelta.current = 0
        }
        document.body.classList.remove('resizing')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onResizeEnd?.()
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [direction, onResize, onResizeEnd]
  )

  const isHorizontal = direction === 'horizontal'

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: isHorizontal ? 4 : '100%',
        height: isHorizontal ? '100%' : 4,
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        flexShrink: 0,
        background: 'transparent',
        position: 'relative',
        zIndex: 5
      }}
    >
      <div
        style={{
          position: 'absolute',
          [isHorizontal ? 'left' : 'top']: 1,
          [isHorizontal ? 'width' : 'height']: 2,
          [isHorizontal ? 'height' : 'width']: '100%',
          background: 'var(--border)',
          transition: 'background 0.15s'
        }}
      />
    </div>
  )
}
