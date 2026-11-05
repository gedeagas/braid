import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OffloadingDelivery } from '../delivery/offloadDelivery'
import { DEFAULT_DELIVERY_CONFIG } from '../delivery/outputDelivery'

// Around a show, the daemon answers the queries in output numbered up to its
// show point; main delivers that output marked no-reply, so the renderer
// doesn't answer it too. On hide, main reports the last seq it delivered.

function harness() {
  const sent: Array<{ data: string; noReply: boolean }> = []
  const delivering = vi.fn()
  const sink = {
    send: vi.fn((_id: string, data: string, noReply?: boolean) => { sent.push({ data, noReply: noReply === true }); return true }),
    pause: vi.fn(),
    resume: vi.fn(),
  }
  const d = new OffloadingDelivery(sink, DEFAULT_DELIVERY_CONFIG, delivering)
  d.setOffload(true)
  return { d, sent, delivering }
}

describe('OffloadingDelivery replies around a show', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('marks output no-reply from the show until the daemon replies, then by its show point', () => {
    const { d, sent, delivering } = harness()
    d.setVisible('a', false)
    d.setVisible('a', true)
    const { token } = delivering.mock.calls.at(-1)![2]
    d.push('a', 'before-reply', 4)
    vi.advanceTimersByTime(5)
    d.push('a', 'queued-old', 5)
    d.setShowPoint('a', 5, token)
    d.push('a', 'new', 6)
    vi.advanceTimersByTime(5)
    expect(sent).toEqual([
      { data: 'before-reply', noReply: true },
      { data: 'queued-old', noReply: true },
      { data: 'new', noReply: false },
    ])
    d.dispose()
  })

  it('splits a slice at the show point', () => {
    const { d, sent, delivering } = harness()
    d.setVisible('a', false)
    d.setVisible('a', true)
    d.setShowPoint('a', 1, delivering.mock.calls.at(-1)![2].token)
    d.push('a', 'old', 1)
    d.push('a', 'new', 2)
    vi.advanceTimersByTime(5)
    expect(sent).toEqual([{ data: 'old', noReply: true }, { data: 'new', noReply: false }])
    d.dispose()
  })

  it('ignores the reply to a show that was already undone', () => {
    const { d, sent, delivering } = harness()
    d.setVisible('a', false)
    d.setVisible('a', true)
    const first = delivering.mock.calls.at(-1)![2].token
    d.setVisible('a', false)
    d.setVisible('a', true)
    d.setShowPoint('a', 9, first)
    d.push('a', 'x', 3)
    vi.advanceTimersByTime(5)
    expect(sent).toEqual([{ data: 'x', noReply: true }]) // still waiting for the current reply
    d.dispose()
  })

  it('reports whether a snapshot follows the show, and what was delivered before a hide', () => {
    const { d, delivering } = harness()
    d.setVisible('a', false)
    d.push('a', 'missed', 1)
    d.setVisible('a', true)
    expect(delivering.mock.calls.at(-1)![2]).toMatchObject({ snapshotFollows: true })
    d.setShowPoint('a', 1, delivering.mock.calls.at(-1)![2].token)
    d.push('a', 'seen', 2)
    vi.advanceTimersByTime(5)
    d.push('a', 'queued', 3)
    d.setVisible('a', false)
    expect(delivering.mock.calls.at(-1)).toEqual(['a', false, { deliveredThrough: 2 }])
    d.dispose()
  })

  it('a failed show reply stops marking output', () => {
    const { d, sent } = harness()
    d.setVisible('a', false)
    d.setVisible('a', true)
    d.clearShowPoint('a')
    d.push('a', 'x', 3)
    vi.advanceTimersByTime(5)
    expect(sent).toEqual([{ data: 'x', noReply: false }])
    d.dispose()
  })
})
