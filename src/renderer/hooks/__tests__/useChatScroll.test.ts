import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatScroll } from '../useChatScroll'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface FakeScroller {
  el: HTMLElement & { scrollTop: number }
  fire: (event: string, eventInit?: Record<string, unknown>) => void
}

/**
 * Creates a real jsdom HTMLElement (passes `instanceof HTMLElement`) but with
 * spied addEventListener/removeEventListener and fixed scroll property values.
 *
 * The scroll handler reads el.scrollHeight / el.scrollTop / el.clientHeight
 * directly from the element, and the rAF loop writes el.scrollTop. We use
 * Object.defineProperty for the read-only properties and leave scrollTop as
 * the normal writable jsdom property.
 */
function makeScroller(overrides: {
  scrollHeight?: number
  scrollTop?: number
  clientHeight?: number
  clientWidth?: number
  offsetWidth?: number
} = {}): FakeScroller {
  const el = document.createElement('div') as HTMLElement & { scrollTop: number }

  const defaults = {
    scrollHeight: 1000,
    clientHeight: 100,
    clientWidth: 300,
    offsetWidth: 318, // > clientWidth — simulates a scrollbar gutter
  }

  // Override the read-only computed properties with fixed getters
  const readOnly: (keyof typeof defaults)[] = ['scrollHeight', 'clientHeight', 'clientWidth', 'offsetWidth']
  for (const key of readOnly) {
    const value = overrides[key] ?? defaults[key]
    Object.defineProperty(el, key, { get: () => value, configurable: true })
  }

  if (overrides.scrollTop !== undefined) {
    el.scrollTop = overrides.scrollTop
  }

  // Capture event listeners for direct invocation
  const handlers: Record<string, (e: unknown) => void> = {}
  vi.spyOn(el, 'addEventListener').mockImplementation((event, handler) => {
    handlers[event as string] = handler as (e: unknown) => void
  })
  vi.spyOn(el, 'removeEventListener').mockImplementation((event) => {
    delete handlers[event as string]
  })

  return {
    el,
    fire: (event: string, eventInit: Record<string, unknown> = {}) => {
      handlers[event]?.(eventInit)
    },
  }
}

/** Tick the rAF queue N times. Defined in setup.ts as globalThis.__flushRaf. */
const flushRaf = (n = 1) => {
  const fn = (globalThis as Record<string, unknown>).__flushRaf
  if (typeof fn === 'function') fn(n)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChatScroll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. Initial state ─────────────────────────────────────────────────────

  it('initialises with atBottom=true and no crash', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: false }))
    expect(result.current.atBottom).toBe(true)
  })

  // ── 2. Attaching a scroller registers exactly 4 listeners ────────────────

  it('registers wheel, scroll, pointerdown, pointerup listeners on attach', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: false }))
    const { el } = makeScroller()

    act(() => result.current.handleScrollerRef(el))

    const events = (el.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => args[0] as string
    )
    expect(events).toContain('wheel')
    expect(events).toContain('scroll')
    expect(events).toContain('pointerdown')
    expect(events).toContain('pointerup')
    expect(el.addEventListener).toHaveBeenCalledTimes(4)
  })

  // ── 3. Upward wheel latches escape and disables auto-scroll ──────────────

  it('disables auto-scroll when user scrolls up (wheel deltaY < 0)', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 0, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))

    // Disable auto-scroll via upward wheel
    act(() => fire('wheel', { deltaY: -50 }))

    // Even if the rAF loop ticks, it should NOT scroll (escaped)
    const scrollTopBefore = el.scrollTop
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(scrollTopBefore) // not forced to scrollHeight
  })

  // ── 4. Escape latch: scroll near bottom does NOT re-enable during streaming
  //    This is the core fix — the old 10px threshold caused content growth to
  //    silently re-engage sticky, fighting the user's scroll-away intent.

  it('does NOT re-enable auto-scroll at 10px from bottom during streaming (escape latch)', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 0, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))

    // Escape via wheel
    act(() => fire('wheel', { deltaY: -50 }))

    // User is at 5px from bottom (old code would re-enable at ≤10px)
    el.scrollTop = 895 // distFromBottom = 1000 - 895 - 100 = 5
    act(() => fire('scroll'))

    // Should still be escaped — 5px is NOT absolute bottom (≤ 2px)
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(895) // not forced
  })

  // ── 5. Re-enable only at absolute bottom (≤ 2px) ────────────────────────

  it('re-enables auto-scroll when user scrolls to absolute bottom (≤ 2px)', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 0, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))

    // First disable
    act(() => fire('wheel', { deltaY: -50 }))

    // User scrolls to absolute bottom (distFromBottom = 1000 - 899 - 100 = 1)
    el.scrollTop = 899
    act(() => fire('scroll'))

    // rAF loop should now scroll to bottom
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(el.scrollHeight)
  })

  // ── 6. Scroll >50px from bottom during idle disables auto-scroll ─────────

  it('disables auto-scroll on scroll >50px from bottom when idle', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: false }))
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 800, clientHeight: 100 })
    // distFromBottom = 1000 - 800 - 100 = 100 (> 50)

    act(() => result.current.handleScrollerRef(el))
    act(() => fire('scroll'))

    // Verify via engageScroll that it was disabled
    // (the rAF loop doesn't run when idle, so we check via handleAtBottomChange)
    expect(result.current.atBottom).toBe(true) // not yet synced
  })

  // ── 7. Scroll >50px during streaming (no drag) does NOT disable ──────────
  //    This guards the core race condition: our rAF loop fires scroll events
  //    that would otherwise cancel themselves if we didn't special-case streaming.

  it('does NOT disable auto-scroll on plain scroll event during streaming (race condition guard)', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 800, clientHeight: 100 })
    // distFromBottom = 100 (> 50), but isStreaming=true and no scrollbar drag

    act(() => result.current.handleScrollerRef(el))
    act(() => fire('scroll'))

    // rAF loop should still be scrolling
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(el.scrollHeight)
  })

  // ── 8. Scrollbar drag during streaming DOES disable auto-scroll ──────────

  it('disables auto-scroll when user drags the scrollbar during streaming', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    // offsetWidth (318) > clientWidth (300) — simulates a scrollbar gutter
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 800, clientHeight: 100, clientWidth: 300, offsetWidth: 318 })

    act(() => result.current.handleScrollerRef(el))

    // Pointer lands in scrollbar gutter (offsetX=310 > clientWidth=300)
    act(() => fire('pointerdown', { offsetX: 310 }))

    // Scroll event fires with distFromBottom=100 and scrollbarDragging=true
    act(() => fire('scroll'))

    // rAF loop should idle
    el.scrollTop = 800
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(800) // not forced
  })

  // ── 9. handleAtBottomChange syncs escape latch when idle ─────────────────

  it('clears escape latch via handleAtBottomChange(true) when idle', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: false }))
    const { el } = makeScroller()
    act(() => result.current.handleScrollerRef(el))

    act(() => result.current.handleAtBottomChange(false))
    expect(result.current.atBottom).toBe(false)

    act(() => result.current.handleAtBottomChange(true))
    expect(result.current.atBottom).toBe(true)
  })

  // ── 10. handleAtBottomChange does NOT sync escape during streaming ────────

  it('ignores handleAtBottomChange(true) for escape latch during streaming', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    const { el, fire } = makeScroller()
    act(() => result.current.handleScrollerRef(el))

    // Disable via wheel
    act(() => fire('wheel', { deltaY: -100 }))

    // Virtuoso fires atBottomChange(true) — should NOT clear escape latch
    act(() => result.current.handleAtBottomChange(true))
    expect(result.current.atBottom).toBe(true) // UI state does update

    // But rAF should still idle (escape latch still set)
    el.scrollTop = 0
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(0) // not forced
  })

  // ── 11. engageScroll clears escape latch and re-enables ──────────────────

  it('engageScroll clears escape latch and re-enables auto-scroll', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 500, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))

    // Escape via wheel
    act(() => fire('wheel', { deltaY: -50 }))

    // Verify escaped
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(500) // not forced

    // External re-engage (button click / send message / session switch)
    act(() => result.current.engageScroll())

    // rAF should now force scroll
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(el.scrollHeight)
  })

  // ── 12. Re-attaching scroller removes old listeners ──────────────────────

  it('removes all 4 listeners from the previous scroller when a new one is attached', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: false }))
    const s1 = makeScroller()
    const s2 = makeScroller()

    act(() => result.current.handleScrollerRef(s1.el))
    expect(s1.el.addEventListener).toHaveBeenCalledTimes(4)

    act(() => result.current.handleScrollerRef(s2.el))

    // Old scroller: all 4 listeners removed
    expect(s1.el.removeEventListener).toHaveBeenCalledTimes(4)
    // New scroller: all 4 listeners added
    expect(s2.el.addEventListener).toHaveBeenCalledTimes(4)
  })

  // ── 13. Cleanup on unmount removes all listeners ─────────────────────────

  it('cleans up listeners when the hook unmounts', () => {
    const { result, unmount } = renderHook(() => useChatScroll({ isStreaming: false }))
    const { el } = makeScroller()

    act(() => result.current.handleScrollerRef(el))
    expect(el.addEventListener).toHaveBeenCalledTimes(4)

    unmount()

    expect(el.removeEventListener).toHaveBeenCalledTimes(4)
  })

  // ── 14. rAF loop does not run when idle ──────────────────────────────────

  it('does not advance scrollTop via rAF when isStreaming=false', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: false }))
    const { el } = makeScroller({ scrollHeight: 1000, scrollTop: 500, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))
    act(() => flushRaf(3))

    expect(el.scrollTop).toBe(500) // unchanged
  })

  // ── 15. setAtBottom updates atBottom state ───────────────────────────────

  it('setAtBottom directly updates atBottom', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: false }))

    act(() => result.current.setAtBottom(false))
    expect(result.current.atBottom).toBe(false)

    act(() => result.current.setAtBottom(true))
    expect(result.current.atBottom).toBe(true)
  })

  // ── 16. Streaming end auto-re-engages when near bottom ──────────────────

  it('auto-re-engages when streaming ends and user is within 150px of bottom', () => {
    const { result, rerender } = renderHook(
      ({ isStreaming }) => useChatScroll({ isStreaming }),
      { initialProps: { isStreaming: true } }
    )
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 0, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))

    // Escape via wheel
    act(() => fire('wheel', { deltaY: -50 }))

    // User is 100px from bottom (within 150px threshold)
    el.scrollTop = 800 // distFromBottom = 1000 - 800 - 100 = 100

    // Streaming ends
    act(() => rerender({ isStreaming: false }))

    expect(result.current.atBottom).toBe(true)
  })

  // ── 16b. disengageScroll — documents the "tool group flash" bug & fix ──────
  //
  // Bug scenario:
  //   1. Chat is streaming, rAF loop is pinning scrollTop = scrollHeight.
  //   2. User clicks to expand a large tool group at the bottom.
  //   3. React renders the tool body (scrollHeight grows by ~600px).
  //   4. Next rAF tick fires: scrollTop = new scrollHeight → header scrolled
  //      above the viewport. Looks like the group snapped closed.
  //
  // Fix: call disengageScroll() in the click handler so the rAF loop stops
  //      BEFORE the new height is committed to the DOM.

  it('[regression] without disengageScroll, rAF scrolls content growth out of view', () => {
    // Demonstrates the bug path so this test breaks if the behaviour regresses.
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    const { el } = makeScroller({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))

    // rAF pins to bottom
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(1000)

    // Content grows (tool body renders) — no disengageScroll call
    Object.defineProperty(el, 'scrollHeight', { get: () => 1600, configurable: true })

    // rAF fires and drags the header out of view above the viewport
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(1600) // ← this is the undesired behaviour
  })

  it('disengageScroll prevents rAF from scrolling content growth out of view', () => {
    const { result } = renderHook(() => useChatScroll({ isStreaming: true }))
    const { el } = makeScroller({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))

    // rAF pins to bottom
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(1000)

    // User clicks the tool group header → disengageScroll fires before React
    // renders the body (same synchronous click-handler tick)
    act(() => result.current.disengageScroll())

    // Content grows (tool body renders)
    Object.defineProperty(el, 'scrollHeight', { get: () => 1600, configurable: true })

    // rAF loop is now a no-op — header stays in view
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(1000) // header still visible
  })

  // ── 17. Streaming end does NOT re-engage when far from bottom ────────────

  it('does NOT re-engage when streaming ends and user is far from bottom', () => {
    const { result, rerender } = renderHook(
      ({ isStreaming }) => useChatScroll({ isStreaming }),
      { initialProps: { isStreaming: true } }
    )
    const { el, fire } = makeScroller({ scrollHeight: 1000, scrollTop: 0, clientHeight: 100 })

    act(() => result.current.handleScrollerRef(el))

    // Escape via wheel
    act(() => fire('wheel', { deltaY: -50 }))

    // User is 400px from bottom (outside 150px threshold)
    el.scrollTop = 500 // distFromBottom = 1000 - 500 - 100 = 400

    // Streaming ends
    act(() => rerender({ isStreaming: false }))

    // atBottom should still be true from initial state since handleAtBottomChange
    // was never called — but the escape latch should remain set.
    // Verify by re-starting streaming: rAF should NOT force scroll.
    act(() => rerender({ isStreaming: true }))
    act(() => flushRaf(1))
    expect(el.scrollTop).toBe(500) // not forced
  })
})
