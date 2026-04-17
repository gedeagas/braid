import { useEffect, useRef, type RefObject } from 'react'

const SWIPE_THRESHOLD = 50 // accumulated px to trigger navigation
const HORIZONTAL_RATIO = 2 // |deltaX| must exceed |deltaY| * this
const GESTURE_END_MS = 300 // silence duration before gesture is considered finished

/**
 * Walk from the event target up to (but not including) the root element.
 * Return true if any ancestor can scroll horizontally - we must not hijack
 * those wheel events (tab bar, code editor, terminal, etc.).
 */
function isInScrollableX(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target as HTMLElement | null
  while (node && node !== root) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const { overflowX } = getComputedStyle(node)
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    node = node.parentElement
  }
  return false
}

/**
 * Detects two-finger horizontal trackpad swipes on the referenced element
 * and calls onNavigate with -1 (previous tab) or 1 (next tab).
 *
 * Skips events that originate inside horizontally scrollable children
 * (tab bar, Monaco editor, terminal, etc.) so we don't steal their scroll.
 *
 * Cooldown is gesture-aware: after a navigation fires, all further events
 * are ignored until the gesture (including macOS momentum scrolling) fully
 * stops - i.e. no wheel events arrive for GESTURE_END_MS.
 */
export function useSwipeNavigation(
  ref: RefObject<HTMLElement | null>,
  onNavigate: (direction: -1 | 1) => void,
): void {
  const callbackRef = useRef(onNavigate)
  callbackRef.current = onNavigate

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let accumulatedX = 0
    let coolingDown = false
    let gestureEndTimer = 0

    const handleWheel = (e: WheelEvent) => {
      // Ignore pinch-to-zoom (ctrlKey is set for trackpad pinch in Chromium)
      if (e.ctrlKey) return

      const absX = Math.abs(e.deltaX)
      const absY = Math.abs(e.deltaY)

      // Only consider predominantly horizontal gestures
      if (absX < absY * HORIZONTAL_RATIO || absX < 2) {
        accumulatedX = 0
        return
      }

      // Don't hijack scroll inside horizontally scrollable children
      if (isInScrollableX(e.target, el)) return

      // Every horizontal wheel event resets the gesture-end timer,
      // even during cooldown. This keeps the cooldown alive as long
      // as macOS momentum events are still arriving.
      window.clearTimeout(gestureEndTimer)
      gestureEndTimer = window.setTimeout(() => {
        accumulatedX = 0
        coolingDown = false
      }, GESTURE_END_MS)

      if (coolingDown) return

      accumulatedX += e.deltaX

      if (Math.abs(accumulatedX) >= SWIPE_THRESHOLD) {
        const direction: -1 | 1 = accumulatedX > 0 ? 1 : -1
        callbackRef.current(direction)

        accumulatedX = 0
        coolingDown = true
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: true })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      window.clearTimeout(gestureEndTimer)
    }
  }, [ref])
}
