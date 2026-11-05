// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const setVisible = vi.fn()
vi.mock('@/lib/ipc', () => ({ pty: { setVisible: (...a: unknown[]) => setVisible(...a) } }))

import { onShowChange, resetVisibilityForTests } from '@/lib/ptyOutput/visibility'
import { useRightTerminalVisibility } from '../useRightTerminalVisibility'
import type { TermTab } from '../terminalCache'

const tab = (id: string, ptyId: string) => ({ id, label: 'Terminal', ptyId }) as unknown as TermTab

describe('useRightTerminalVisibility', () => {
  beforeEach(() => { setVisible.mockClear(); resetVisibilityForTests() })

  it('keeps the active tab shown when a rename replaces its wrapper', () => {
    const changes: boolean[] = []
    onShowChange((_t, shown) => changes.push(shown))
    const a = tab('a', 'p1')
    const { rerender } = renderHook(({ tabs }) => useRightTerminalVisibility(tabs, 'a'), { initialProps: { tabs: [a] } })
    const renamed = { ...a, label: 'Renamed' } as TermTab
    rerender({ tabs: [renamed] })
    expect(setVisible.mock.calls).toEqual([['p1', true]])
    expect(changes).toEqual([true])
  })

  it('hides the previous tab when another one is shown', () => {
    const a = tab('a', 'p1')
    const b = tab('b', 'p2')
    const { rerender } = renderHook(({ id }) => useRightTerminalVisibility([a, b], id), { initialProps: { id: 'a' } })
    rerender({ id: 'b' })
    expect(setVisible.mock.calls).toEqual([['p1', true], ['p1', false], ['p2', true]])
  })
})
