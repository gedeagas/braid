import { describe, it, expect } from 'vitest'
import { nextSlice, SYNC_BEGIN, SYNC_END } from '../delivery/sliceOutput'

const limits = { maxChars: 16, maxSyncFrame: 64 }

describe('nextSlice', () => {
  it('sends short output whole', () => {
    expect(nextSlice('hello', limits)).toEqual({ length: 5, splitFrame: false })
  })

  it('cuts plain output at maxChars', () => {
    expect(nextSlice('x'.repeat(40), limits).length).toBe(16)
  })

  it('never splits a UTF-16 surrogate pair', () => {
    // 15 ASCII chars then an emoji (2 code units) straddling the 16-char cut.
    const text = 'a'.repeat(15) + '😀' + 'b'.repeat(10)
    const { length } = nextSlice(text, limits)
    expect(length).toBe(15)
    expect(text.slice(0, length).endsWith('a')).toBe(true)
  })

  it('cuts before a synchronized frame that straddles the limit', () => {
    const frame = SYNC_BEGIN + 'y'.repeat(20) + SYNC_END
    const text = 'abc' + frame
    expect(nextSlice(text, limits).length).toBe(3)
  })

  it('sends a whole frame at the head even when it is larger than maxChars', () => {
    const frame = SYNC_BEGIN + 'y'.repeat(30) + SYNC_END
    const text = frame + 'tail'
    expect(nextSlice(text, limits).length).toBe(frame.length)
  })

  it('holds an unfinished frame at the head while it is small', () => {
    const text = SYNC_BEGIN + 'partial redraw'
    expect(nextSlice(text, limits).length).toBe(0)
  })

  it('sends an unfinished small frame when forced (hold expired)', () => {
    const text = SYNC_BEGIN + 'partial redraw'
    expect(nextSlice(text, limits, { force: true }).length).toBe(16)
  })

  it('splits a frame that is already larger than maxSyncFrame', () => {
    const text = SYNC_BEGIN + 'z'.repeat(100) + SYNC_END
    const result = nextSlice(text, limits)
    expect(result).toEqual({ length: 16, splitFrame: true })
  })

  it('splits an unfinished frame that already exceeds maxSyncFrame', () => {
    const text = SYNC_BEGIN + 'z'.repeat(100)
    expect(nextSlice(text, limits)).toEqual({ length: 16, splitFrame: true })
  })

  it('treats the head of a frame that was already split as plain output', () => {
    const text = 'z'.repeat(30) + SYNC_END + 'after'
    expect(nextSlice(text, limits, { headInFrame: true })).toEqual({ length: 16, splitFrame: true })
  })

  it('does not hold when the frame closed before the cut', () => {
    // BEGIN + END is exactly 16 chars, so the frame is complete at the cut.
    const text = SYNC_BEGIN + SYNC_END + 'x'.repeat(30)
    expect(nextSlice(text, limits)).toEqual({ length: 16, splitFrame: false })
  })

  it('reports leaving a split frame once the cut passes its end', () => {
    const text = 'z'.repeat(4) + SYNC_END + 'x'.repeat(30)
    expect(nextSlice(text, limits, { headInFrame: true })).toEqual({ length: 16, splitFrame: false })
  })
})
