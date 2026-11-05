import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TypingFastPath, DEFAULT_FAST_PATH } from '../delivery/typingFastPath'
import { OutputDelivery, DEFAULT_DELIVERY_CONFIG } from '../delivery/outputDelivery'

describe('TypingFastPath', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses the documented limits', () => {
    expect(DEFAULT_FAST_PATH).toEqual({ windowMs: 100, maxChars: 1024, maxCharsWithEscapes: 16 * 1024, budget: 32 * 1024 })
  })

  it('only takes output within 100ms of a keystroke', () => {
    const fp = new TypingFastPath()
    expect(fp.take('a', 'x')).toBe(false)
    fp.noteInput('a')
    vi.advanceTimersByTime(100)
    expect(fp.take('a', 'x')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(fp.take('a', 'x')).toBe(false)
  })

  it('takes plain output under 1,024 chars, and TUI redraws with escapes under 16KB', () => {
    const fp = new TypingFastPath()
    fp.noteInput('a')
    expect(fp.take('a', 'x'.repeat(1023))).toBe(true)
    expect(fp.take('a', 'x'.repeat(1024))).toBe(false)
    expect(fp.take('a', '\x1b[2K' + 'y'.repeat(8000))).toBe(true)
    expect(fp.take('a', '\x1b[2K' + 'y'.repeat(16 * 1024))).toBe(false)
  })

  it('has a 32K budget per terminal that refills on each keystroke', () => {
    const fp = new TypingFastPath()
    fp.noteInput('a')
    const redraw = '\x1b[H' + 'z'.repeat(12_000)
    expect(fp.take('a', redraw)).toBe(true)
    expect(fp.take('a', redraw)).toBe(true)
    expect(fp.take('a', redraw)).toBe(false) // 36K > 32K
    expect(fp.take('b', 'x')).toBe(false) // per terminal
    fp.noteInput('a')
    expect(fp.take('a', redraw)).toBe(true)
  })
})

describe('OutputDelivery typing fast path and visibility', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function harness() {
    const sent: Array<{ id: string; data: string }> = []
    const sink = { send: vi.fn((id: string, data: string) => { sent.push({ id, data }); return true }), pause: vi.fn(), resume: vi.fn() }
    return { delivery: new OutputDelivery(sink, DEFAULT_DELIVERY_CONFIG), sent }
  }

  it('sends a keystroke echo immediately, without waiting for the 2ms batch', () => {
    const { delivery, sent } = harness()
    delivery.noteInput('a')
    delivery.push('a', 'k')
    expect(sent).toEqual([{ id: 'a', data: 'k' }])
    expect(delivery.unacked('a')).toBe(1)
    delivery.dispose()
  })

  it('keeps order: echo waits behind output that is already queued', () => {
    const { delivery, sent } = harness()
    delivery.push('a', 'earlier')
    delivery.noteInput('a')
    delivery.push('a', 'k')
    expect(sent).toEqual([])
    vi.advanceTimersByTime(2)
    expect(sent.map((s) => s.data).join('')).toBe('earlierk')
    delivery.dispose()
  })

  it('batches output that arrives long after the keystroke', () => {
    const { delivery, sent } = harness()
    delivery.noteInput('a')
    vi.advanceTimersByTime(150)
    delivery.push('a', 'late')
    expect(sent).toEqual([])
    vi.advanceTimersByTime(2)
    expect(sent).toEqual([{ id: 'a', data: 'late' }])
    delivery.dispose()
  })

  it('serves visible terminals before hidden ones in each flush', () => {
    const { delivery, sent } = harness()
    delivery.setVisible('hidden1', false)
    delivery.push('hidden1', 'h')
    delivery.push('shown', 's')
    delivery.setVisible('hidden2', false)
    delivery.push('hidden2', 'h2')
    vi.advanceTimersByTime(2)
    expect(sent.map((s) => s.id)).toEqual(['shown', 'hidden1', 'hidden2'])
    delivery.setVisible('hidden1', true)
    delivery.push('hidden2', 'x')
    delivery.push('hidden1', 'y')
    vi.advanceTimersByTime(2)
    expect(sent.slice(3).map((s) => s.id)).toEqual(['hidden1', 'hidden2'])
    delivery.dispose()
  })

  it('gives the extra room only while the typed-into terminal is on screen', () => {
    const sent: string[] = []
    const sink = { send: vi.fn((_id: string, d: string) => { sent.push(d); return true }), pause: vi.fn(), resume: vi.fn() }
    const budget = { perTerminal: 16 * 1024, total: 1024 * 1024, interactivePerTerminal: 16 * 1024, interactiveTotal: 0 }
    const delivery = new OutputDelivery(sink, { ...DEFAULT_DELIVERY_CONFIG, budget })
    delivery.noteInput('a')
    delivery.setVisible('a', false)
    vi.advanceTimersByTime(200) // past the typing window
    delivery.push('a', 'x'.repeat(64 * 1024))
    vi.advanceTimersByTime(20)
    expect(sent.join('').length).toBe(16 * 1024)
    delivery.setVisible('a', true)
    delivery.push('a', 'y')
    vi.advanceTimersByTime(20)
    expect(sent.join('').length).toBe(32 * 1024)
    delivery.dispose()
  })
})
