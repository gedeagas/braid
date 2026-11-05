import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OffloadingDelivery, SNAPSHOT_HOLD_TIMEOUT_MS } from '../delivery/offloadDelivery'
import { DEFAULT_DELIVERY_CONFIG } from '../delivery/outputDelivery'

function harness(offload = true) {
  const sent: Array<{ id: string; data: string }> = []
  const delivering = vi.fn()
  const sink = { send: vi.fn((id: string, data: string) => { sent.push({ id, data }); return true }), pause: vi.fn(), resume: vi.fn() }
  const d = new OffloadingDelivery(sink, DEFAULT_DELIVERY_CONFIG, delivering)
  d.setOffload(offload)
  const text = (id = 'a') => sent.filter((s) => s.id === id).map((s) => s.data).join('')
  return { d, sent, text, delivering }
}

describe('OffloadingDelivery (hidden terminals)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends nothing for a hidden terminal, and marks it stale', () => {
    const { d, text, delivering } = harness()
    d.setVisible('a', false)
    expect(delivering).toHaveBeenCalledWith('a', false, {})
    d.push('a', 'hidden output', 1)
    vi.advanceTimersByTime(10)
    expect(text()).toBe('')
    expect(d.isStale('a')).toBe(true)
    d.dispose()
  })

  it('drops what was queued when a terminal is hidden', () => {
    const { d, text } = harness()
    d.push('a', 'queued', 1)
    d.setVisible('a', false)
    vi.advanceTimersByTime(10)
    expect(text()).toBe('')
    d.dispose()
  })

  it('leaves hidden terminals out of the renderer limit', () => {
    const { d } = harness()
    d.push('a', 'x'.repeat(1000), 1)
    vi.advanceTimersByTime(2)
    expect(d.totalUnacked()).toBe(1000)
    d.setVisible('a', false)
    expect(d.totalUnacked()).toBe(0)
    d.setVisible('a', true)
    expect(d.totalUnacked()).toBe(1000)
    d.dispose()
  })

  it('keeps delivering a hidden terminal while the renderer still needs its output', () => {
    const { d, text } = harness()
    d.setVisible('a', false)
    d.setInterest('a', true)
    d.push('a', 'waiting for the agent prompt', 1)
    vi.advanceTimersByTime(2)
    expect(text()).toBe('waiting for the agent prompt')
    d.setInterest('a', false)
    d.push('a', 'more', 2)
    vi.advanceTimersByTime(2)
    expect(text()).toBe('waiting for the agent prompt')
    d.dispose()
  })

  it('in legacy mode (old daemon) delivers hidden terminals as today', () => {
    const { d, text, delivering } = harness(false)
    d.setVisible('a', false)
    d.push('a', 'still sent', 1)
    vi.advanceTimersByTime(2)
    expect(text()).toBe('still sent')
    expect(delivering).not.toHaveBeenCalled()
    expect(d.isStale('a')).toBe(false)
    d.dispose()
  })
})

describe('OffloadingDelivery seq handoff', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('on reveal: holds live output and sends only what is newer than the snapshot', () => {
    const { d, text } = harness()
    d.setVisible('a', false)
    for (let seq = 1; seq <= 3; seq++) d.push('a', `[${seq}]`, seq)
    d.setVisible('a', true)
    d.beginHold('a')
    d.push('a', '[4]', 4) // in the snapshot (daemon emitted it before the request)
    d.push('a', '[5]', 5) // after the snapshot
    vi.advanceTimersByTime(10)
    expect(text()).toBe('')
    d.endHold('a', 4)
    vi.advanceTimersByTime(2)
    expect(text()).toBe('[5]')
    expect(d.isStale('a')).toBe(false)
    d.dispose()
  })

  it('on reattach: output arriving before the snapshot is never duplicated or lost', () => {
    const { d, text } = harness()
    d.markStale('a')
    d.beginHold('a')
    for (let seq = 1; seq <= 6; seq++) d.push('a', `[${seq}]`, seq)
    d.endHold('a', 3)
    for (let seq = 7; seq <= 8; seq++) d.push('a', `[${seq}]`, seq)
    vi.advanceTimersByTime(5)
    expect(text()).toBe('[4][5][6][7][8]')
    d.dispose()
  })

  it('drops the unsent rest of a chunk the snapshot already covers', () => {
    const { d, text } = harness()
    d.push('a', 'x'.repeat(40 * 1024), 1)
    vi.advanceTimersByTime(2) // 32KB of it sent
    d.beginHold('a')
    d.push('a', 'next', 2)
    d.endHold('a', 1)
    vi.advanceTimersByTime(5)
    expect(text().length).toBe(32 * 1024 + 'next'.length)
    expect(text().endsWith('next')).toBe(true)
    d.dispose()
  })

  it('releases a hold the renderer never confirmed, and re-snapshots next time', () => {
    const { d, text } = harness()
    d.markStale('a')
    d.beginHold('a')
    d.push('a', 'lost?', 1)
    vi.advanceTimersByTime(SNAPSHOT_HOLD_TIMEOUT_MS + 1)
    expect(text()).toBe('')
    expect(d.isStale('a')).toBe(true)
    d.push('a', 'live', 2)
    vi.advanceTimersByTime(2)
    expect(text()).toBe('live')
    d.dispose()
  })

  it('stays stale when hidden again before the snapshot is confirmed', () => {
    const { d } = harness()
    d.setVisible('a', false)
    d.push('a', '[1]', 1)
    d.setVisible('a', true)
    d.beginHold('a')
    d.setVisible('a', false)
    d.push('a', '[2]', 2) // dropped while hidden, not in snapshot 1
    d.endHold('a', 1)
    expect(d.isStale('a')).toBe(true)
    d.dispose()
  })

  it('stays stale when the snapshot failed', () => {
    const { d } = harness()
    d.markStale('a')
    d.beginHold('a')
    d.releaseHold('a')
    expect(d.isStale('a')).toBe(true)
    d.dispose()
  })

  it('resumes the producer when the queue that paused it is dropped', () => {
    for (const drop of ['snapshot', 'timeout', 'hide'] as const) {
      const sink = { send: vi.fn(() => true), pause: vi.fn(), resume: vi.fn() }
      const d = new OffloadingDelivery(sink, DEFAULT_DELIVERY_CONFIG)
      d.setOffload(true)
      d.setProducerPause(true)
      d.markStale('a')
      d.beginHold('a')
      d.push('a', 'x'.repeat(300 * 1024), 1)
      expect(sink.pause).toHaveBeenCalledWith('a')
      if (drop === 'snapshot') d.endHold('a', 1)
      else if (drop === 'timeout') vi.advanceTimersByTime(SNAPSHOT_HOLD_TIMEOUT_MS + 1)
      else d.setVisible('a', false)
      expect(sink.resume).toHaveBeenCalledWith('a')
      d.dispose()
    }
  })

  it('a terminal that never missed output needs no snapshot', () => {
    const { d } = harness()
    d.push('a', 'shown all along', 1)
    vi.advanceTimersByTime(2)
    expect(d.isStale('a')).toBe(false)
    d.dispose()
  })

  it('still waits for the renderer to listen after a reload (no leaked credit)', () => {
    const { d, text } = harness()
    d.reset()
    d.push('a', 'early', 1)
    vi.advanceTimersByTime(10)
    expect(text()).toBe('')
    expect(d.unacked('a')).toBe(0)
    d.setRendererReady()
    vi.advanceTimersByTime(2)
    expect(text()).toBe('early')
    d.dispose()
  })
})
