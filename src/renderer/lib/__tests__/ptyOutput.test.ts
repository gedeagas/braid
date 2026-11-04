import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ackData = vi.fn()
const rendererReady = vi.fn()
let dataHandler: ((id: string, data: string) => void) | null = null
let exitHandler: ((id: string, code: number) => void) | null = null
vi.mock('@/lib/ipc', () => ({
  pty: {
    ackData: (...args: unknown[]) => ackData(...args),
    rendererReady: () => rendererReady(),
    onData: (cb: (id: string, data: string) => void) => { dataHandler = cb; return () => { dataHandler = null } },
    onExit: (cb: (id: string, code: number) => void) => { exitHandler = cb; return () => { exitHandler = null } },
  },
}))

import { writeToTerminal, ACK_EVERY_CHARS, ACK_EVERY_MS, resetAckTrackerForTests } from '../ptyOutput/writeOutput'
import { initPtyOutputRouting, registerPtyFinder, registerPtyTerminal, routePtyOutput } from '../ptyOutput/router'
import { replayIntoTerminal, isReplaying } from '../replayGuard'

/** Minimal xterm stand-in: write callbacks run when flush() is called. */
function fakeTerm() {
  const pending: Array<() => void> = []
  const written: string[] = []
  return {
    written,
    write: vi.fn((data: string, cb?: () => void) => { written.push(data); if (cb) pending.push(cb) }),
    flush: () => { while (pending.length) pending.shift()!() },
  }
}

describe('writeToTerminal (renderer limit acks)', () => {
  beforeEach(() => { vi.useFakeTimers(); ackData.mockClear(); resetAckTrackerForTests() })
  afterEach(() => vi.useRealTimers())

  it('acks a running total once xterm has parsed the output', () => {
    const term = fakeTerm()
    writeToTerminal(term, 'x'.repeat(ACK_EVERY_CHARS), { ptyId: 'p1' })
    expect(ackData).not.toHaveBeenCalled()
    term.flush()
    expect(ackData).toHaveBeenCalledWith('p1', ACK_EVERY_CHARS)
  })

  it('batches small writes: at most every 5,000 chars or 16ms', () => {
    const term = fakeTerm()
    writeToTerminal(term, 'ab', { ptyId: 'p1' })
    writeToTerminal(term, 'cde', { ptyId: 'p1' })
    term.flush()
    expect(ackData).not.toHaveBeenCalled()
    vi.advanceTimersByTime(ACK_EVERY_MS)
    expect(ackData).toHaveBeenCalledTimes(1)
    expect(ackData).toHaveBeenCalledWith('p1', 5)
  })

  it('keeps a separate, increasing total per terminal', () => {
    const a = fakeTerm()
    const b = fakeTerm()
    writeToTerminal(a, 'x'.repeat(6000), { ptyId: 'pa' })
    writeToTerminal(b, 'y'.repeat(7000), { ptyId: 'pb' })
    a.flush()
    b.flush()
    writeToTerminal(a, 'x'.repeat(6000), { ptyId: 'pa' })
    a.flush()
    expect(ackData.mock.calls).toEqual([['pa', 6000], ['pb', 7000], ['pa', 12000]])
  })

  it('does not ack writes that did not come from pty:data (replay)', () => {
    const term = fakeTerm()
    const onParsed = vi.fn()
    writeToTerminal(term, 'x'.repeat(10_000), { onParsed })
    term.flush()
    vi.advanceTimersByTime(100)
    expect(onParsed).toHaveBeenCalled()
    expect(ackData).not.toHaveBeenCalled()
  })
})

describe('PTY output routing', () => {
  beforeEach(() => { vi.useFakeTimers(); ackData.mockClear(); resetAckTrackerForTests() })
  afterEach(() => vi.useRealTimers())

  it('subscribes once to pty:data, then tells main it is listening', () => {
    initPtyOutputRouting()
    initPtyOutputRouting()
    expect(dataHandler).not.toBeNull()
    expect(rendererReady).toHaveBeenCalledTimes(1)
  })

  it('restarts the running total of a PTY id after it exited (reused id)', () => {
    initPtyOutputRouting()
    routePtyOutput('bt-1-1', 'x'.repeat(ACK_EVERY_CHARS))
    expect(ackData).toHaveBeenLastCalledWith('bt-1-1', ACK_EVERY_CHARS)
    exitHandler?.('bt-1-1', 0)
    routePtyOutput('bt-1-1', 'y'.repeat(ACK_EVERY_CHARS))
    expect(ackData).toHaveBeenLastCalledWith('bt-1-1', ACK_EVERY_CHARS)
  })

  it('writes output to the terminal a finder returns, and acks after parsing', () => {
    const term = fakeTerm()
    registerPtyFinder((id) => (id === 'found' ? term : undefined))
    routePtyOutput('found', 'hello')
    expect(term.written).toEqual(['hello'])
    term.flush()
    vi.advanceTimersByTime(ACK_EVERY_MS)
    expect(ackData).toHaveBeenCalledWith('found', 5)
  })

  it('routes to a terminal registered for one PTY (setup panel), until unregistered', () => {
    const term = fakeTerm()
    const off = registerPtyTerminal('setup-1', term)
    routePtyOutput('setup-1', 'npm i')
    expect(term.written).toEqual(['npm i'])
    off()
    routePtyOutput('setup-1', 'more')
    expect(term.written).toEqual(['npm i'])
  })

  it('acks output nobody displays right away, so main never stalls on it', () => {
    routePtyOutput('nobody', 'x'.repeat(ACK_EVERY_CHARS))
    expect(ackData).toHaveBeenCalledWith('nobody', ACK_EVERY_CHARS)
  })
})

describe('replay guard uses the shared write helper', () => {
  beforeEach(() => { ackData.mockClear(); resetAckTrackerForTests() })

  it('guards until xterm parsed the replay, and never acks it', () => {
    const term = fakeTerm()
    replayIntoTerminal('t1', term as never, 'old output')
    expect(isReplaying('t1')).toBe(true)
    term.flush()
    expect(isReplaying('t1')).toBe(false)
    expect(ackData).not.toHaveBeenCalled()
  })
})
