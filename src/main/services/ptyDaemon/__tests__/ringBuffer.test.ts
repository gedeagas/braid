import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../ringBuffer'

describe('RingBuffer under a flood', () => {
  it('keeps exactly the newest output across many small chunks', () => {
    const buf = new RingBuffer(1_000)
    let all = ''
    for (let i = 0; i < 5_000; i++) {
      const chunk = `${i},`
      buf.push(chunk)
      all += chunk
    }
    const out = buf.read()
    expect(out.length).toBeLessThanOrEqual(1_000)
    expect(all.endsWith(out)).toBe(true)
    expect(out.length).toBeGreaterThan(990)
  })

  it('evicts in constant time per chunk once full (no Array.shift scans)', () => {
    // A full 10MB buffer of ~1KB chunks, like a flooding terminal. The old
    // shift()-based trim took seconds here and was 55% of daemon CPU.
    const buf = new RingBuffer(10_000_000)
    const chunk = 'y\n'.repeat(32) // small reads, as node-pty delivers under a flood
    const start = performance.now()
    for (let i = 0; i < 600_000; i++) buf.push(chunk)
    expect(performance.now() - start).toBeLessThan(1_000)
    expect(buf.read().length).toBeLessThanOrEqual(10_000_000)
  })

  it('still trims when the limit shrinks, and clears', () => {
    const buf = new RingBuffer(100)
    for (let i = 0; i < 10; i++) buf.push('abcdefghij')
    buf.setMaxLength(25)
    // Whole chunks are evicted, so up to one chunk less may remain.
    expect(buf.read()).toBe('abcdefghij'.repeat(2))
    buf.clear()
    expect(buf.read()).toBe('')
    buf.push('x')
    expect(buf.read()).toBe('x')
  })
})
