import { useRef, useCallback, useState, useEffect } from 'react'

interface UseDragScrollOptions {
  /** Scroll axis: 'x' for horizontal, 'y' for vertical. Default: 'x' */
  axis?: 'x' | 'y'
  /** Pixels of movement before classifying as a drag (not a click). Default: 5 */
  dragThreshold?: number
  /** Velocity decay per rAF frame, 0–1. Default: 0.92 (~300ms coast) */
  momentumFriction?: number
}

interface UseDragScrollReturn {
  /** Attach to the scrollable container's onMouseDown */
  onMouseDown: (e: React.MouseEvent<HTMLElement>) => void
  /** True while the user is actively dragging */
  isDragging: boolean
  /**
   * Attach to the container's onClickCapture to suppress the click event
   * that fires immediately after a drag ends.
   *
   * Using capture phase means it fires before any child handler — including
   * close buttons that call e.stopPropagation() in their own onClick.
   *
   * Usage:
   *   <div onClickCapture={preventClickAfterDrag()}>
   */
  preventClickAfterDrag: (handler?: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => void
}

export function useDragScroll<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  options: UseDragScrollOptions = {}
): UseDragScrollReturn {
  const { axis = 'x', dragThreshold = 5, momentumFriction = 0.92 } = options
  const isVertical = axis === 'y'

  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const startPos = useRef(0)
  const startScroll = useRef(0)
  const totalMovement = useRef(0)
  const wasJustDragging = useRef(false)

  // Momentum tracking
  const velocityRef = useRef(0)
  const lastPos = useRef(0)
  const lastT = useRef(0)
  const rafId = useRef<number | null>(null)

  const cancelMomentum = useCallback(() => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
  }, [])

  // Cancel momentum on unmount
  useEffect(() => () => cancelMomentum(), [cancelMomentum])

  const runMomentum = useCallback(() => {
    const el = ref.current
    if (!el) return
    velocityRef.current *= momentumFriction
    if (Math.abs(velocityRef.current) < 0.5) {
      rafId.current = null
      return
    }
    if (isVertical) {
      el.scrollTop -= velocityRef.current
    } else {
      el.scrollLeft -= velocityRef.current
    }
    rafId.current = requestAnimationFrame(runMomentum)
  }, [ref, momentumFriction, isVertical])

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (e.button !== 0) return
      // Don't hijack drags that start on interactive form elements
      const target = e.target as HTMLElement
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return

      // Don't interfere with draggable tab elements (HTML5 DnD)
      const draggable = target.closest('[draggable="true"]')
      if (draggable) return

      // Don't interfere with Monaco editor or other embedded editors
      if (target.closest('.monaco-editor')) return

      const el = ref.current
      if (!el) return

      // Prevent browser text-selection and native button-drag from interfering
      e.preventDefault()

      cancelMomentum()

      isDraggingRef.current = false
      setIsDragging(false)
      totalMovement.current = 0
      const clientPos = isVertical ? e.clientY : e.clientX
      startPos.current = clientPos
      startScroll.current = isVertical ? el.scrollTop : el.scrollLeft
      lastPos.current = clientPos
      lastT.current = performance.now()
      velocityRef.current = 0

      const handleMouseMove = (ev: MouseEvent) => {
        const pos = isVertical ? ev.clientY : ev.clientX
        totalMovement.current += Math.abs(pos - lastPos.current)

        if (!isDraggingRef.current && totalMovement.current > dragThreshold) {
          isDraggingRef.current = true
          setIsDragging(true)
          document.body.style.cursor = 'grabbing'
          document.body.style.userSelect = 'none'
        }

        if (isDraggingRef.current) {
          const scrollOffset = startScroll.current - (pos - startPos.current)
          if (isVertical) {
            el.scrollTop = scrollOffset
          } else {
            el.scrollLeft = scrollOffset
          }

          // Track velocity as px/frame (assuming ~16ms per frame at 60fps)
          const now = performance.now()
          const dt = now - lastT.current
          if (dt > 0) {
            velocityRef.current = ((lastPos.current - pos) / dt) * 16
          }
          lastPos.current = pos
          lastT.current = now
        }
      }

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        if (isDraggingRef.current) {
          // Block the click event that the browser fires right after mouseup
          wasJustDragging.current = true
          setTimeout(() => {
            wasJustDragging.current = false
          }, 0)

          // Kick off momentum if there's enough velocity
          if (Math.abs(velocityRef.current) > 1) {
            rafId.current = requestAnimationFrame(runMomentum)
          }
        }

        isDraggingRef.current = false
        setIsDragging(false)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [ref, dragThreshold, cancelMomentum, runMomentum, isVertical]
  )

  const preventClickAfterDrag = useCallback(
    (handler?: (e: React.MouseEvent) => void) =>
      (e: React.MouseEvent) => {
        if (wasJustDragging.current) {
          e.stopPropagation()
          e.preventDefault()
          return
        }
        handler?.(e)
      },
    []
  )

  return { onMouseDown, isDragging, preventClickAfterDrag }
}
