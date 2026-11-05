import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: string[] = []
let snapshotResult: unknown = null
let resolveSnapshot: ((v: unknown) => void) | null = null
vi.mock('@/lib/ipc', () => ({
  pty: {
    ackData: vi.fn(),
    onData: vi.fn(() => () => {}),
    setVisible: vi.fn(),
    headlessSnapshot: vi.fn(() => {
      calls.push('snapshot')
      return new Promise((r) => { resolveSnapshot = r; if (snapshotResult) r(snapshotResult) })
    }),
    snapshotApplied: vi.fn((id: string, seq: number) => calls.push(`applied:${id}:${seq}`)),
  },
}))

import { revealTerminal, isAwaitingSnapshot, setReplyGuard, setExitMarker } from '../ptyOutput/reveal'
import { routePtyOutput, registerPtyFinder } from '../ptyOutput/router'
import { isReplaying } from '../replayGuard'

function fakeTerm() {
  const pending: Array<() => void> = []
  const log: string[] = []
  const term = {
    cols: 80, rows: 24, log,
    write: vi.fn((data: string, cb?: () => void) => { log.push(`write:${data}`); if (cb) pending.push(cb) }),
    reset: vi.fn(() => log.push('reset')),
    resize: vi.fn((c: number, r: number) => { term.cols = c; term.rows = r; log.push(`resize:${c}x${r}`) }),
    flush: () => { while (pending.length) pending.shift()!() },
  }
  return term
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('revealTerminal', () => {
  beforeEach(() => { calls.length = 0; snapshotResult = null; resolveSnapshot = null })

  it('drops live output while waiting, resets, writes the snapshot in the replay guard, then confirms its seq', async () => {
    const term = fakeTerm()
    registerPtyFinder((id) => (id === 'p1' ? term : undefined))
    const done = revealTerminal({ ptyId: 'p1', guardId: 'bt-1', term })
    expect(isAwaitingSnapshot('p1')).toBe(true)
    // Output main sent before it began holding is covered by the snapshot.
    routePtyOutput('p1', 'stale live output')
    expect(term.log).toEqual([])

    resolveSnapshot!({ data: 'SCREEN', cols: 100, rows: 30, seq: 17, title: 't' })
    await tick()
    term.flush() // barrier write parsed
    await tick()
    expect(term.log.slice(0, 4)).toEqual(['write:', 'reset', 'resize:100x30', 'write:SCREEN'])
    expect(isReplaying('bt-1')).toBe(true)
    expect(calls).toEqual(['snapshot'])
    term.flush() // snapshot parsed
    await done
    expect(isReplaying('bt-1')).toBe(false)
    expect(calls).toEqual(['snapshot', 'applied:p1:17'])
    expect(isAwaitingSnapshot('p1')).toBe(false)
  })

  it('does nothing to the screen when main says it is up to date', async () => {
    const term = fakeTerm()
    snapshotResult = { upToDate: true }
    await revealTerminal({ ptyId: 'p2', guardId: 'bt-2', term })
    expect(term.reset).not.toHaveBeenCalled()
    expect(calls).toEqual(['snapshot'])
    expect(isAwaitingSnapshot('p2')).toBe(false)
  })

  it('gives up cleanly without a snapshot (legacy daemon or session gone)', async () => {
    const term = fakeTerm()
    const done = revealTerminal({ ptyId: 'p3', guardId: 'bt-3', term })
    resolveSnapshot!(null)
    expect(await done).toBe(false)
    expect(term.reset).not.toHaveBeenCalled()
    expect(isAwaitingSnapshot('p3')).toBe(false)
  })

  it('keeps output that arrived while waiting when main says up to date, or has no snapshot', async () => {
    for (const reply of [{ upToDate: true }, null]) {
      calls.length = 0
      const term = fakeTerm()
      const id = reply ? 'p5' : 'p6'
      registerPtyFinder((pid) => (pid === id ? term : undefined))
      const done = revealTerminal({ ptyId: id, guardId: 'bt-5', term })
      routePtyOutput(id, 'one ')
      routePtyOutput(id, 'two')
      resolveSnapshot!(reply)
      await done
      routePtyOutput(id, ' three')
      expect(term.log).toEqual(['write:one ', 'write:two', 'write: three'])
    }
  })

  it('reveals once more when shown again while a reveal is running (it was hidden meanwhile)', async () => {
    const term = fakeTerm()
    const first = revealTerminal({ ptyId: 'p7', guardId: 'bt-7', term })
    const again = revealTerminal({ ptyId: 'p7', guardId: 'bt-7', term }, { again: true })
    expect(calls).toEqual(['snapshot'])
    resolveSnapshot!({ upToDate: true })
    await first
    await tick()
    expect(calls).toEqual(['snapshot', 'snapshot'])
    resolveSnapshot!({ upToDate: true })
    await again
  })

  it('runs one reveal at a time per terminal', async () => {
    const term = fakeTerm()
    snapshotResult = { upToDate: true }
    await Promise.all([
      revealTerminal({ ptyId: 'p4', guardId: 'bt-4', term }),
      revealTerminal({ ptyId: 'p4', guardId: 'bt-4', term }),
    ])
    expect(calls).toEqual(['snapshot'])
  })

  it('writes no-reply output under the replay guard, live and when kept aside', async () => {
    const term = fakeTerm()
    registerPtyFinder((id) => (id === 'p9' ? term : undefined))
    const guarded: boolean[] = []
    term.write.mockImplementation((data: string, cb?: () => void) => {
      guarded.push(isReplaying('bt-9'))
      term.log.push(`write:${data}`)
      cb?.()
    })
    const done = revealTerminal({ ptyId: 'p9', guardId: 'bt-9', term })
    routePtyOutput('p9', 'kept', true) // daemon answers its queries
    resolveSnapshot!({ upToDate: true })
    await done
    routePtyOutput('p9', 'old', true)
    routePtyOutput('p9', 'new')
    expect(term.log).toEqual(['write:kept', 'write:old', 'write:new'])
    expect(guarded).toEqual([true, true, false])
  })

  it('guards no-reply output of a terminal that was never revealed (shown right after spawning)', () => {
    const term = fakeTerm()
    registerPtyFinder((id) => (id === 'p10' ? term : undefined))
    const guarded: boolean[] = []
    term.write.mockImplementation((_data: string, cb?: () => void) => { guarded.push(isReplaying('bt-10')); cb?.() })
    setReplyGuard('p10', 'bt-10')
    routePtyOutput('p10', '\x1b[c', true)
    expect(guarded).toEqual([true])
  })

  it('shows the final screen of a PTY that exited while hidden, then its exit marker, without confirming a seq', async () => {
    const term = fakeTerm()
    term.write.mockImplementation((data: string, cb?: () => void) => { term.log.push(`write:${data}`); cb?.() })
    setExitMarker('p11', '[exited]')
    snapshotResult = { data: 'FINAL', cols: 80, rows: 24, seq: 3, title: '', exited: true }
    expect(await revealTerminal({ ptyId: 'p11', guardId: 'bt-11', term })).toBe(true)
    expect(term.log).toEqual(['write:', 'reset', 'write:FINAL', 'write:[exited]'])
    expect(calls).toEqual(['snapshot'])
  })
})
