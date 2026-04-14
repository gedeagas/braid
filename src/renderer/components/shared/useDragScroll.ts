import { useRef, useCallback } from 'react'

/**
 * useDragScroll — attach to a horizontally-scrollable container to enable
 * click-and-drag scrolling.
 *
 * Spread the returned `onMouseDown` onto the container element and assign the
 * returned `ref` to it. Cursor changes to 'grabbing' while dragging.
 *
 * Clicks are suppressed via a capture-phase interceptor when the pointer has
 * moved more than DRAG_THRESHOLD pixels, so tab-switch / close / rename
 * handlers on child elements still fire on genuine clicks.
 */

const DRAG_THRESHOLD = 4 // px

export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const startXRef = useRef(0)
  const startScrollRef = useRef(0)
  const dragOccurredRef = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Skip drag setup when mousedown lands directly on a button or input —
    // those elements have their own click semantics and should not start scrolling.
    const tag = (e.target as HTMLElement).tagName.toLowerCase()
    if (tag === 'button' || tag === 'input') return

    const el = ref.current
    if (!el) return

    startXRef.current = e.clientX
    startScrollRef.current = el.scrollLeft
    dragOccurredRef.current = false

    el.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startXRef.current
      if (!dragOccurredRef.current && Math.abs(dx) > DRAG_THRESHOLD) {
        dragOccurredRef.current = true
      }
      if (dragOccurredRef.current) {
        el.scrollLeft = startScrollRef.current - dx
      }
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)

      el.style.cursor = ''
      document.body.style.userSelect = ''

      // If a real drag occurred, swallow the next native click before React's
      // synthetic event system processes it — preventing accidental tab switches
      // or close actions after a drag.
      if (dragOccurredRef.current) {
        window.addEventListener(
          'click',
          (ev) => {
            ev.stopPropagation()
            ev.preventDefault()
          },
          { capture: true, once: true }
        )
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  return { ref, onMouseDown }
}
