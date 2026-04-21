import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCopyToClipboard } from '../useCopyToClipboard'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(navigator, { clipboard: { writeText } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeClick(): React.MouseEvent {
  return { stopPropagation: vi.fn() } as unknown as React.MouseEvent
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCopyToClipboard', () => {
  it('starts with copied = false', () => {
    const { result } = renderHook(() => useCopyToClipboard('hello'))
    expect(result.current.copied).toBe(false)
  })

  it('sets copied to true after handleCopy', () => {
    const { result } = renderHook(() => useCopyToClipboard('hello'))

    act(() => {
      result.current.handleCopy(fakeClick())
    })

    expect(result.current.copied).toBe(true)
  })

  it('calls navigator.clipboard.writeText with the provided text', () => {
    const { result } = renderHook(() => useCopyToClipboard('some code'))

    act(() => {
      result.current.handleCopy(fakeClick())
    })

    expect(writeText).toHaveBeenCalledWith('some code')
  })

  it('calls stopPropagation on the click event', () => {
    const { result } = renderHook(() => useCopyToClipboard('x'))
    const event = fakeClick()

    act(() => {
      result.current.handleCopy(event)
    })

    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('resets copied to false after 2 seconds', () => {
    const { result } = renderHook(() => useCopyToClipboard('hello'))

    act(() => {
      result.current.handleCopy(fakeClick())
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.copied).toBe(false)
  })

  it('does not reset early if handleCopy is called again before timer fires', () => {
    const { result } = renderHook(() => useCopyToClipboard('hello'))

    act(() => {
      result.current.handleCopy(fakeClick())
    })

    // Advance 1.5s, then copy again — should restart the timer
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      result.current.handleCopy(fakeClick())
    })

    // Advance another 1.5s — old timer would have fired, but new one hasn't
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(result.current.copied).toBe(true)

    // Advance remaining 500ms to complete the 2s window
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.copied).toBe(false)
  })

  it('clears the timer on unmount', () => {
    const { result, unmount } = renderHook(() => useCopyToClipboard('hello'))

    act(() => {
      result.current.handleCopy(fakeClick())
    })

    unmount()

    // Advancing time after unmount should not throw
    act(() => {
      vi.advanceTimersByTime(3000)
    })
  })
})
