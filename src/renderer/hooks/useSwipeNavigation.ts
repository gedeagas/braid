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
 * Two layers of protection against macOS momentum double-triggers:
 *
 * 1. Gesture-aware cooldown: after navigation fires, all events are ignored
 *    until no wheel events arrive for GESTURE_END_MS. The timer resets on
 *    ANY wheel event (not just horizontal) so vertical/mixed momentum events
 *    can't cause premature cooldown expiry.
 *
 * 2. Delta decay detection (inspired by Lethargy): momentum events have
 *    monotonically decreasing |deltaX|. We reject events whose absolute
 *    delta is significantly smaller than the previous one - these are
 *    inertial, not real user input.
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
    let lastAbsDeltaX = 0

    const handleWheel = (e: WheelEvent) => {
      // Ignore pinch-to-zoom (ctrlKey is set for trackpad pinch in Chromium)
      if (e.ctrlKey) return

      // Reset gesture-end timer on EVERY wheel event - even vertical ones.
      // Any wheel activity means the gesture (or its momentum tail) is still
      // ongoing. This prevents the cooldown from expiring while mixed
      // horizontal/vertical momentum events are still flowing.
      window.clearTimeout(gestureEndTimer)
      gestureEndTimer = window.setTimeout(() => {
        accumulatedX = 0
        coolingDown = false
        lastAbsDeltaX = 0
      }, GESTURE_END_MS)

      const absX = Math.abs(e.deltaX)
      const absY = Math.abs(e.deltaY)

      // Only consider predominantly horizontal gestures
      if (absX < absY * HORIZONTAL_RATIO || absX < 2) {
        accumulatedX = 0
        lastAbsDeltaX = 0
        return
      }

      // Don't hijack scroll inside horizontally scrollable children
      if (isInScrollableX(e.target, el)) return

      if (coolingDown) return

      // Delta decay detection: momentum events have decreasing |deltaX|.
      // If the current delta dropped significantly from the previous one,
      // we're in the inertia phase - skip it to avoid false triggers.
      const isDeltaDecaying = lastAbsDeltaX > 0 && absX < lastAbsDeltaX * 0.5
      lastAbsDeltaX = absX
      if (isDeltaDecaying) return

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
