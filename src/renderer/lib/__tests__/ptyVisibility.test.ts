import { describe, it, expect, vi, beforeEach } from 'vitest'

const setVisible = vi.fn()
vi.mock('@/lib/ipc', () => ({ pty: { setVisible: (...a: unknown[]) => setVisible(...a) } }))

import { setShown, syncShown, forgetShown, resetVisibilityForTests } from '../ptyOutput/visibility'

describe('terminal visibility reporting', () => {
  beforeEach(() => { setVisible.mockClear(); resetVisibilityForTests() })

  it('reports a change once', () => {
    const t = { ptyId: 'p1', shown: false }
    setShown(t, true)
    setShown(t, true)
    setShown(t, false)
    expect(setVisible.mock.calls).toEqual([['p1', true], ['p1', false]])
  })

  it('remembers the state until the PTY exists, then reports it', () => {
    const t: { ptyId: string | null; shown: boolean } = { ptyId: null, shown: false }
    setShown(t, false)
    expect(setVisible).not.toHaveBeenCalled()
    t.ptyId = 'p2'
    syncShown(t)
    // Main treats unknown terminals as visible, so hidden must be reported.
    expect(setVisible).toHaveBeenCalledWith('p2', false)
  })

  it('reports again after a terminal is forgotten and reused', () => {
    const t = { ptyId: 'p3', shown: false }
    setShown(t, true)
    forgetShown('p3')
    syncShown(t)
    expect(setVisible.mock.calls).toEqual([['p3', true], ['p3', true]])
  })
})
