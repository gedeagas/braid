import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SocketBackpressure } from '../socketBackpressure'

const limits = { high: 1000, low: 200, sessionHigh: 100, sessionLow: 50 }

/** A socket whose writes complete only when flushed. */
function slowSocket() {
  const callbacks: Array<() => void> = []
  return {
    write: vi.fn((_line: string, cb?: () => void) => { if (cb) callbacks.push(cb); return true }),
    flush: (n = callbacks.length) => { for (let i = 0; i < n; i++) callbacks.shift()?.() },
  }
}

describe('SocketBackpressure (daemon -> main)', () => {
  const pause = vi.fn()
  const resume = vi.fn()
  let bp: SocketBackpressure
  beforeEach(() => { pause.mockClear(); resume.mockClear(); bp = new SocketBackpressure(pause, resume, limits) })

  it('pauses the sessions filling a stalled client once its backlog passes the high mark', () => {
    const sock = slowSocket()
    for (let i = 0; i < 9; i++) bp.write('c1', 's1', sock, 'x'.repeat(100))
    bp.write('c1', 's2', sock, 'y'.repeat(20))
    expect(pause).not.toHaveBeenCalled()
    bp.write('c1', 's1', sock, 'x'.repeat(100))
    expect(pause).toHaveBeenCalledWith('s1', 'c1')
    expect(pause).not.toHaveBeenCalledWith('s2', 'c1') // a quiet session keeps running
  })

  it('resumes once the client drains below the low mark', () => {
    const sock = slowSocket()
    for (let i = 0; i < 11; i++) bp.write('c1', 's1', sock, 'x'.repeat(100))
    expect(pause).toHaveBeenCalledTimes(1)
    sock.flush(5)
    expect(resume).not.toHaveBeenCalled()
    sock.flush()
    expect(resume).toHaveBeenCalledWith('s1', 'c1')
  })

  it('keeps clients apart: one slow client does not pause output to another', () => {
    const slow = slowSocket()
    const fast = slowSocket()
    for (let i = 0; i < 11; i++) bp.write('slow', 's1', slow, 'x'.repeat(100))
    bp.write('fast', 's2', fast, 'z')
    fast.flush()
    expect(pause.mock.calls).toEqual([['s1', 'slow']])
  })

  it('releases everything for a client that disconnected', () => {
    const sock = slowSocket()
    for (let i = 0; i < 11; i++) bp.write('c1', 's1', sock, 'x'.repeat(100))
    bp.release('c1')
    expect(resume).toHaveBeenCalledWith('s1', 'c1')
    sock.flush() // late callbacks are ignored
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('pauses again when the safety valve resumed a session the client is still behind on', () => {
    const sock = slowSocket()
    for (let i = 0; i < 11; i++) bp.write('c1', 's1', sock, 'x'.repeat(100))
    expect(pause).toHaveBeenCalledTimes(1)
    bp.write('c1', 's1', sock, 'x') // output again: the valve let it run
    expect(pause).toHaveBeenCalledTimes(2)
  })
})
