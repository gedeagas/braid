import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OutputDelivery, DEFAULT_DELIVERY_CONFIG, type DeliveryConfig } from '../delivery/outputDelivery'
import { OutputQueue } from '../delivery/outputQueue'
import { SYNC_BEGIN, SYNC_END } from '../delivery/sliceOutput'

const KB = 1024

function harness(config: Partial<DeliveryConfig> = {}) {
  const sent: Array<{ id: string; data: string }> = []
  const sink = {
    send: vi.fn((id: string, data: string) => { sent.push({ id, data }); return true }),
    pause: vi.fn(),
    resume: vi.fn(),
  }
  const delivery = new OutputDelivery(sink, { ...DEFAULT_DELIVERY_CONFIG, ...config })
  const textFor = (id: string) => sent.filter((s) => s.id === id).map((s) => s.data).join('')
  return { delivery, sink, sent, textFor }
}

describe('OutputQueue', () => {
  it('peeks and takes across chunk boundaries', () => {
    const q = new OutputQueue()
    q.push('abc', 1)
    q.push('defg', 2)
    expect(q.length).toBe(7)
    expect(q.peek(5)).toBe('abcde')
    expect(q.take(2)).toBe('ab')
    expect(q.take(3)).toBe('cde')
    expect(q.length).toBe(2)
    expect(q.peek(100)).toBe('fg')
  })

  it('drops whole chunks up to a sequence number', () => {
    const q = new OutputQueue()
    q.push('one', 1)
    q.push('two', 2)
    q.push('three', 3)
    q.take(1) // partly sent chunk 1
    expect(q.dropThrough(2)).toBe(5)
    expect(q.peek(100)).toBe('three')
  })
})

describe('OutputDelivery batching', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('batches output and flushes after 2ms', () => {
    const { delivery, sink } = harness()
    delivery.push('a', 'hel')
    delivery.push('a', 'lo')
    expect(sink.send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(sink.send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(sink.send).toHaveBeenCalledWith('a', 'hello')
    delivery.dispose()
  })

  it('sends at most two 16KB slices per terminal per flush, then follows up 1ms later', () => {
    const { delivery, sent } = harness()
    delivery.push('a', 'x'.repeat(40 * KB))
    vi.advanceTimersByTime(2)
    expect(sent.map((s) => s.data.length)).toEqual([16 * KB, 16 * KB])
    vi.advanceTimersByTime(1)
    expect(sent.map((s) => s.data.length)).toEqual([16 * KB, 16 * KB, 8 * KB])
    delivery.dispose()
  })

  it('serves every terminal in the same flush', () => {
    const { delivery, sent } = harness()
    delivery.push('a', 'x'.repeat(50 * KB))
    delivery.push('b', 'y')
    vi.advanceTimersByTime(2)
    expect(sent.map((s) => s.id)).toEqual(['a', 'a', 'b'])
    delivery.dispose()
  })

  it('never splits a surrogate pair across slices', () => {
    const { delivery, sent } = harness()
    const text = 'a'.repeat(16 * KB - 1) + '😀' + 'tail'
    delivery.push('a', text)
    vi.advanceTimersByTime(2)
    expect(sent[0].data.length).toBe(16 * KB - 1)
    expect(sent.map((s) => s.data).join('')).toBe(text)
    delivery.dispose()
  })

  it('keeps a DEC 2026 frame in one slice', () => {
    const { delivery, sent } = harness()
    const frame = SYNC_BEGIN + 'f'.repeat(40 * KB) + SYNC_END
    delivery.push('a', 'pre' + frame + 'post')
    vi.advanceTimersByTime(2)
    expect(sent.map((s) => s.data)).toEqual(['pre', frame])
    vi.advanceTimersByTime(1)
    expect(sent[2].data).toBe('post')
    delivery.dispose()
  })

  it('holds an unfinished small frame, then sends it once the hold expires', () => {
    const { delivery, sent } = harness()
    delivery.push('a', SYNC_BEGIN + 'redraw')
    vi.advanceTimersByTime(2)
    expect(sent).toHaveLength(0)
    delivery.push('a', '...' + SYNC_END)
    vi.advanceTimersByTime(2)
    expect(sent.map((s) => s.data)).toEqual([SYNC_BEGIN + 'redraw...' + SYNC_END])

    delivery.push('a', SYNC_BEGIN + 'stuck')
    vi.advanceTimersByTime(DEFAULT_DELIVERY_CONFIG.syncHoldMs + 5)
    expect(sent[1].data).toBe(SYNC_BEGIN + 'stuck')
    delivery.dispose()
  })

  it('sends everything queued before forgetting a terminal that exited', () => {
    const { delivery, textFor } = harness({ budget: { perTerminal: 10, total: 100, interactivePerTerminal: 10, interactiveTotal: 10 } })
    delivery.push('a', 'x'.repeat(100))
    delivery.drain('a')
    expect(textFor('a')).toHaveLength(100)
    expect(delivery.queued('a')).toBe(0)
    delivery.dispose()
  })

  it('does not count output nobody received', () => {
    const { delivery, sink } = harness()
    sink.send.mockReturnValue(false)
    delivery.push('a', 'x'.repeat(100))
    vi.advanceTimersByTime(2)
    expect(delivery.unacked('a')).toBe(0)
    delivery.dispose()
  })
})

describe('OutputDelivery renderer limit (Stage A)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const budget = { perTerminal: 32 * KB, total: 64 * KB, interactivePerTerminal: 32 * KB, interactiveTotal: 32 * KB }

  it('stops at the per-terminal limit and continues after an ack', () => {
    const { delivery, textFor } = harness({ budget })
    delivery.push('a', 'x'.repeat(100 * KB))
    vi.advanceTimersByTime(50)
    expect(textFor('a')).toHaveLength(32 * KB)
    delivery.ack('a', 16 * KB)
    vi.advanceTimersByTime(5)
    expect(textFor('a')).toHaveLength(48 * KB)
    delivery.dispose()
  })

  it('ignores lower or repeated running totals', () => {
    const { delivery, textFor } = harness({ budget })
    delivery.push('a', 'x'.repeat(100 * KB))
    vi.advanceTimersByTime(50)
    delivery.ack('a', 16 * KB)
    vi.advanceTimersByTime(5)
    delivery.ack('a', 16 * KB)
    delivery.ack('a', 8 * KB)
    vi.advanceTimersByTime(50)
    expect(textFor('a')).toHaveLength(48 * KB)
    delivery.dispose()
  })

  it('gives the terminal being typed into room beyond the limits others are stopped at', () => {
    const { delivery, textFor } = harness({ budget })
    delivery.push('a', 'x'.repeat(100 * KB))
    delivery.push('b', 'x'.repeat(100 * KB))
    delivery.push('c', 'x'.repeat(100 * KB))
    vi.advanceTimersByTime(50)
    // Total limit 64KB reached by a and b.
    expect(textFor('a').length + textFor('b').length + textFor('c').length).toBe(64 * KB)
    delivery.noteInput('c')
    delivery.push('c', 'y')
    vi.advanceTimersByTime(50)
    expect(textFor('c').length).toBe(32 * KB) // the interactive total reserve
    delivery.dispose()
  })

  it('resets counts on renderer reload and resumes paused sessions', () => {
    const { delivery, sink, textFor } = harness({ budget, rendererReadyWatchdogMs: 60_000 })
    delivery.setProducerPause(true)
    delivery.push('a', 'x'.repeat(400 * KB))
    vi.advanceTimersByTime(50)
    expect(sink.pause).toHaveBeenCalledWith('a')
    delivery.reset()
    expect(sink.resume).toHaveBeenCalledWith('a')
    expect(delivery.unacked('a')).toBe(0)
    expect(delivery.queued('a')).toBe(0)
    delivery.push('a', 'fresh')
    vi.advanceTimersByTime(2)
    // Nothing goes to the new page until its output listener is up.
    expect(textFor('a').endsWith('fresh')).toBe(false)
    delivery.setRendererReady()
    vi.advanceTimersByTime(2)
    expect(textFor('a').endsWith('fresh')).toBe(true)
    delivery.dispose()
  })

  it('opens the gate after a watchdog if the ready signal never comes', () => {
    const { delivery, textFor } = harness({ budget, rendererReadyWatchdogMs: 10_000 })
    delivery.reset()
    delivery.push('a', 'held')
    vi.advanceTimersByTime(9_999)
    expect(textFor('a')).toBe('')
    vi.advanceTimersByTime(5)
    expect(textFor('a')).toBe('held')
    delivery.dispose()
  })

  it('never counts output sent before the renderer listens (no leaked credit)', () => {
    const { delivery, sink } = harness({ budget, rendererReadyWatchdogMs: 60_000 })
    delivery.reset()
    delivery.noteInput('a')
    delivery.push('a', 'k') // even the typing fast path waits
    vi.advanceTimersByTime(10)
    expect(sink.send).not.toHaveBeenCalled()
    expect(delivery.unacked('a')).toBe(0)
    delivery.dispose()
  })

  it('in legacy mode sends a terminal past the limit once it has more than the bypass size queued', () => {
    const { delivery, textFor } = harness({ budget, bypassQueue: 64 * KB })
    delivery.push('a', 'x'.repeat(100 * KB))
    vi.advanceTimersByTime(50)
    // 32KB fit the budget; the rest is sent down to the bypass size.
    expect(delivery.queued('a')).toBeLessThanOrEqual(64 * KB)
    expect(textFor('a').length).toBe(100 * KB - delivery.queued('a'))
    delivery.dispose()
  })
})

describe('OutputDelivery producer pause (Stage B)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pauses the producer when the queue backs up and resumes after it drains', () => {
    const budget = { perTerminal: 16 * KB, total: 96 * KB, interactivePerTerminal: 16 * KB, interactiveTotal: 16 * KB }
    const { delivery, sink } = harness({ budget })
    delivery.setProducerPause(true)
    delivery.push('a', 'x'.repeat(300 * KB))
    expect(sink.pause).toHaveBeenCalledWith('a')
    for (let processed = 16 * KB; processed <= 300 * KB; processed += 16 * KB) {
      vi.advanceTimersByTime(3)
      delivery.ack('a', processed)
    }
    vi.advanceTimersByTime(3)
    expect(sink.resume).toHaveBeenCalledWith('a')
    delivery.dispose()
  })

  it('never pauses without the flow-control feature', () => {
    const { delivery, sink } = harness({ budget: { perTerminal: 1, total: 4, interactivePerTerminal: 1, interactiveTotal: 1 } })
    delivery.push('a', 'x'.repeat(300 * KB))
    vi.advanceTimersByTime(10_000)
    expect(sink.pause).not.toHaveBeenCalled()
    delivery.dispose()
  })
})
