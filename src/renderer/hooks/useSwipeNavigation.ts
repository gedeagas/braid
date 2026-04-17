import { useEffect, useRef, type RefObject } from 'react'

const SWIPE_THRESHOLD = 50 // accumulated px to trigger navigation
const HORIZONTAL_RATIO = 2 // |deltaX| must exceed |deltaY| * this
const COOLDOWN_MS = 400 // prevent re-trigger during momentum scrolling
const RESET_MS = 200 // reset accumulator after gesture pause

/**
 * Detects two-finger horizontal trackpad swipes on the referenced element
 * and calls onNavigate with -1 (previous tab) or 1 (next tab).
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
    let resetTimer = 0
    let cooldownTimer = 0

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

      if (coolingDown) return

      accumulatedX += e.deltaX

      // Reset after a pause in wheel events (gesture ended)
      window.clearTimeout(resetTimer)
      resetTimer = window.setTimeout(() => {
        accumulatedX = 0
      }, RESET_MS)

      if (Math.abs(accumulatedX) >= SWIPE_THRESHOLD) {
        const direction: -1 | 1 = accumulatedX > 0 ? 1 : -1
        callbackRef.current(direction)

        accumulatedX = 0
        coolingDown = true
        window.clearTimeout(resetTimer)
        cooldownTimer = window.setTimeout(() => {
          coolingDown = false
        }, COOLDOWN_MS)
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: true })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      window.clearTimeout(resetTimer)
      window.clearTimeout(cooldownTimer)
    }
  }, [ref])
}
