import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'

interface UseChatScrollOptions {
  isStreaming: boolean
}

interface UseChatScrollReturn {
  handleScrollerRef: (ref: HTMLElement | Window | null) => void
  handleAtBottomChange: (bottom: boolean) => void
  atBottom: boolean
  setAtBottom: (value: boolean) => void
  /** Clear the escape latch and re-engage auto-scroll. Use this instead of
   *  setting wantsBottomRef directly — it ensures escapedRef is also cleared. */
  engageScroll: () => void
  /** Set the escape latch and stop auto-scroll. Use when the user interacts
   *  with content (e.g. expanding a tool group) to prevent the rAF loop from
   *  immediately scrolling the content they're reading out of view. */
  disengageScroll: () => void
  scrollerRef: React.MutableRefObject<HTMLElement | null>
}

/**
 * Manages sticky-bottom scroll for a streaming chat view.
 *
 * Uses an `escapedFromLock` latch pattern (same approach as VS Code terminal,
 * Discord, ChatGPT, and StackBlitz use-stick-to-bottom):
 *
 *   - **Break**: Any upward wheel, scrollbar drag, or Virtuoso atBottom=false
 *     while idle sets `escapedFromLock = true`. Once escaped, the rAF loop
 *     stops forcing scroll and content growth can never silently re-engage it.
 *
 *   - **Re-engage** (explicit user intent only):
 *     1. Scroll-to-bottom button click → `engageScroll()`
 *     2. User sends a message → `engageScroll()`
 *     3. Session switch → `engageScroll()`
 *     4. User manually scrolls to absolute bottom (≤ 2px) — tiny threshold to
 *        ensure it's deliberate, not content-growth drift.
 *
 *   - **Streaming end**: When streaming stops and the user is within 150px of
 *     bottom, auto-re-engage so idle reading isn't stuck with the button showing.
 */
export function useChatScroll({ isStreaming }: UseChatScrollOptions): UseChatScrollReturn {
  const [atBottom, setAtBottom] = useState(true)
  const wantsBottomRef = useRef(true)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const scrollListenerCleanupRef = useRef<(() => void) | null>(null)
  const isStreamingRef = useRef(false)
  const escapedRef = useRef(false)

  // Keep isStreamingRef in sync so the stable scroll callback can read it.
  useLayoutEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  // When streaming ends, auto-re-engage if the user is close to the bottom.
  // This covers the common case where content finished growing and the user is
  // essentially reading the last few lines — no need to force a manual click.
  const prevStreamingRef = useRef(isStreaming)
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current
    prevStreamingRef.current = isStreaming
    if (wasStreaming && !isStreaming && escapedRef.current) {
      const el = scrollerRef.current
      if (el) {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight
        if (dist <= 150) {
          escapedRef.current = false
          wantsBottomRef.current = true
          setAtBottom(true)
        }
      }
    }
  }, [isStreaming])

  const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    // Clean up previous listeners
    if (scrollListenerCleanupRef.current) {
      scrollListenerCleanupRef.current()
      scrollListenerCleanupRef.current = null
    }
    scrollerRef.current = ref instanceof HTMLElement ? ref : null
    const el = scrollerRef.current
    if (el) {
      // Wheel: immediately latch escapedFromLock on any upward scroll before
      // the rAF loop can re-force the position.
      const handleWheel = (e: WheelEvent) => {
        if (e.deltaY < 0) {
          escapedRef.current = true
          wantsBottomRef.current = false
        }
      }
      // Scrollbar drag detection: a pointerdown whose X coordinate lands in the
      // scrollbar gutter (between clientWidth and offsetWidth) is a scrollbar
      // grab. Flag it so handleScroll treats the resulting events as user intent.
      let scrollbarDragging = false
      const handlePointerDown = (e: PointerEvent) => {
        if (e.offsetX > el.clientWidth) scrollbarDragging = true
      }
      const handlePointerUp = () => { scrollbarDragging = false }
      // Scroll: only re-engages auto-scroll when the user manually scrolls to
      // the absolute bottom (≤ 2px). During streaming, the rAF loop fires
      // scroll events constantly — we skip the re-enable path for those because
      // escapedRef prevents them from mattering anyway.
      // The tiny 2px threshold ensures only deliberate "I scrolled all the way
      // down" counts, not content growth pushing dist below a generous threshold.
      const handleScroll = () => {
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        if (distFromBottom <= 2) {
          // User reached absolute bottom — clear the escape latch.
          escapedRef.current = false
          wantsBottomRef.current = true
        } else if (distFromBottom > 50 && (!isStreamingRef.current || scrollbarDragging)) {
          // Scrollbar drag during streaming or any scroll away while idle.
          escapedRef.current = true
          wantsBottomRef.current = false
        }
      }
      el.addEventListener('wheel', handleWheel, { passive: true })
      el.addEventListener('scroll', handleScroll, { passive: true })
      el.addEventListener('pointerdown', handlePointerDown, { passive: true })
      el.addEventListener('pointerup', handlePointerUp, { passive: true })
      scrollListenerCleanupRef.current = () => {
        el.removeEventListener('wheel', handleWheel)
        el.removeEventListener('scroll', handleScroll)
        el.removeEventListener('pointerdown', handlePointerDown)
        el.removeEventListener('pointerup', handlePointerUp)
      }
    }
  }, [])

  const handleAtBottomChange = useCallback((bottom: boolean) => {
    setAtBottom(bottom)
    // During streaming, the escape latch owns wantsBottomRef — don't let
    // Virtuoso's coarse atBottomThreshold (200px) re-enable forced scroll.
    if (!isStreamingRef.current) {
      if (bottom) {
        escapedRef.current = false
        wantsBottomRef.current = true
      } else {
        escapedRef.current = true
        wantsBottomRef.current = false
      }
    }
  }, [])

  // rAF loop: directly set scrollTop on the DOM scroller element (not through
  // VirtuosoHandle) so we always reach the true DOM bottom, which includes the
  // Footer area that Virtuoso's internal scroll accounting may undercount.
  //
  // wantsBottomRef is the single source of truth for "should we force scroll".
  // escapedRef is the latch that prevents content growth from silently
  // re-enabling forced scroll — once escaped, only explicit user intent
  // (button click, send message, manual scroll to absolute bottom) clears it.
  useEffect(() => {
    if (!isStreaming) return
    let rafId: number
    let lastScrollHeight = 0
    const loop = () => {
      const el = scrollerRef.current
      if (el && wantsBottomRef.current) {
        // Only force-scroll when content has actually grown. This prevents
        // fighting macOS elastic overscroll when the user holds the trackpad
        // at the bottom boundary - the rAF loop no longer snaps scrollTop
        // back 60fps when nothing has changed.
        if (el.scrollHeight !== lastScrollHeight) {
          lastScrollHeight = el.scrollHeight
          el.scrollTop = el.scrollHeight
        }
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [isStreaming])

  // Explicit re-engage: clears the escape latch and re-enables auto-scroll.
  // Callers (scroll-to-bottom button, send message, session switch) must use
  // this instead of poking wantsBottomRef directly.
  const engageScroll = useCallback(() => {
    escapedRef.current = false
    wantsBottomRef.current = true
  }, [])

  const disengageScroll = useCallback(() => {
    escapedRef.current = true
    wantsBottomRef.current = false
  }, [])

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      if (scrollListenerCleanupRef.current) {
        scrollListenerCleanupRef.current()
        scrollListenerCleanupRef.current = null
      }
    }
  }, [])

  return {
    handleScrollerRef,
    handleAtBottomChange,
    atBottom,
    setAtBottom,
    engageScroll,
    disengageScroll,
    scrollerRef,
  }
}
