import { describe, it, expect } from 'vitest'
import { percentile, droppedFramesFor, summarize } from '../perfProbe'

describe('perf probe statistics', () => {
  it('computes median and p95', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(xs, 50)).toBe(50)
    expect(percentile(xs, 95)).toBe(95)
    expect(percentile([], 50)).toBe(0)
  })

  it('counts frames missed between two animation frames at 60Hz', () => {
    expect(droppedFramesFor(16.7)).toBe(0)
    expect(droppedFramesFor(24)).toBe(0)
    expect(droppedFramesFor(34)).toBe(1)
    expect(droppedFramesFor(100)).toBe(5)
  })

  it('summarizes a run', () => {
    expect(summarize([10, 20, 30], 4, 100)).toEqual({
      typing: { samples: 3, medianMs: 20, p95Ms: 30 }, droppedFrames: 4, frames: 100,
    })
  })
})
