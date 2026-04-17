import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSwipeNavigation } from '../useSwipeNavigation'

// GESTURE_END_MS in the hook is 300
const GESTURE_END_MS = 300

function fireWheel(el: HTMLElement, deltaX: number, deltaY = 0, ctrlKey = false) {
  el.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, ctrlKey, bubbles: true }))
}

describe('useSwipeNavigation', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.removeChild(container)
  })

  it('navigates forward on rightward swipe exceeding threshold', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    fireWheel(container, 20)
    fireWheel(container, 25)
    fireWheel(container, 20)

    expect(onNavigate).toHaveBeenCalledWith(1)
  })

  it('navigates backward on leftward swipe exceeding threshold', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    fireWheel(container, -20)
    fireWheel(container, -25)
    fireWheel(container, -20)

    expect(onNavigate).toHaveBeenCalledWith(-1)
  })

  it('does not navigate for small deltas below threshold', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    fireWheel(container, 10)
    fireWheel(container, 10)

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('ignores predominantly vertical gestures', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    // deltaY is large relative to deltaX, fails horizontal ratio check
    fireWheel(container, 30, 30)
    fireWheel(container, 30, 30)

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('ignores pinch-to-zoom (ctrlKey)', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    fireWheel(container, 60, 0, true)

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('blocks re-trigger while momentum events are still arriving', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    // First swipe triggers
    fireWheel(container, 60)
    expect(onNavigate).toHaveBeenCalledTimes(1)

    // Decaying momentum events keep arriving - should stay in cooldown
    vi.advanceTimersByTime(100)
    fireWheel(container, 20)
    vi.advanceTimersByTime(100)
    fireWheel(container, 10)
    vi.advanceTimersByTime(100)
    fireWheel(container, 5)

    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('vertical momentum events also extend cooldown', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    // First swipe triggers
    fireWheel(container, 60)
    expect(onNavigate).toHaveBeenCalledTimes(1)

    // Mixed vertical momentum events arrive - these should keep
    // the cooldown alive even though they fail the horizontal check
    vi.advanceTimersByTime(200)
    fireWheel(container, 3, 15) // mostly vertical
    vi.advanceTimersByTime(200)
    fireWheel(container, 2, 10) // mostly vertical

    // Not enough silence yet (only 200ms since last event, need 300)
    vi.advanceTimersByTime(200)

    // Even if horizontal events arrive now, cooldown hasn't ended
    // because last wheel event was only 200ms ago
    fireWheel(container, 60)
    // This is still in cooldown since the vertical events kept resetting the timer
    // and we haven't had 300ms of silence yet
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('allows new gesture after momentum fully stops', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    // First gesture
    fireWheel(container, 60)
    expect(onNavigate).toHaveBeenCalledTimes(1)

    // Silence long enough for gesture to end
    vi.advanceTimersByTime(GESTURE_END_MS + 50)

    // New gesture triggers (increasing deltas = real user input)
    fireWheel(container, 25)
    fireWheel(container, 30)
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it('rejects decaying momentum deltas after cooldown expires', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    // First gesture
    fireWheel(container, 60)
    expect(onNavigate).toHaveBeenCalledTimes(1)

    // Full silence - cooldown ends
    vi.advanceTimersByTime(GESTURE_END_MS + 50)

    // Simulate a second swipe where deltas decay rapidly (momentum artifact)
    // 30 -> 10 (dropped > 50%) - delta decay kicks in
    fireWheel(container, 30)
    fireWheel(container, 10) // rejected: 10 < 30 * 0.5
    fireWheel(container, 5)  // rejected: 5 < 10 * 0.5

    // Never reaches threshold because decaying events are rejected
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('resets accumulator after gesture pause', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    // Partial swipe (30 < 50 threshold)
    fireWheel(container, 30)

    // Pause exceeds gesture-end timer
    vi.advanceTimersByTime(GESTURE_END_MS + 50)

    // New partial swipe should not combine with previous
    fireWheel(container, 30)

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('ignores tiny deltaX values (noise)', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    // deltaX < 2 is filtered out
    for (let i = 0; i < 100; i++) {
      fireWheel(container, 1)
    }

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('skips events from horizontally scrollable children', () => {
    const onNavigate = vi.fn()
    const ref = { current: container }
    renderHook(() => useSwipeNavigation(ref, onNavigate))

    // Create a child that can scroll horizontally (e.g. tab bar)
    const scrollChild = document.createElement('div')
    scrollChild.style.overflowX = 'auto'
    Object.defineProperty(scrollChild, 'scrollWidth', { value: 800, configurable: true })
    Object.defineProperty(scrollChild, 'clientWidth', { value: 300, configurable: true })
    container.appendChild(scrollChild)

    // Wheel from the scrollable child bubbles up but should be ignored
    fireWheel(scrollChild, 60)
    fireWheel(scrollChild, 60)

    expect(onNavigate).not.toHaveBeenCalled()

    // Wheel from a non-scrollable child still triggers
    const plainChild = document.createElement('div')
    container.appendChild(plainChild)

    fireWheel(plainChild, 25)
    fireWheel(plainChild, 30)

    expect(onNavigate).toHaveBeenCalledWith(1)
  })
})
