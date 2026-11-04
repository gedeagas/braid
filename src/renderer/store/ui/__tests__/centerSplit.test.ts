import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/store/ui'
import { getPaneLayout, placeTabInPane, activateKey, getFocusedView } from '@/lib/centerPanes'

const WT = 'wt-split'

function reset(view: Parameters<ReturnType<typeof useUIStore.getState>['setActiveCenterView']>[0] = null) {
  localStorage.clear()
  useUIStore.setState({
    selectedWorktreeId: WT,
    tabOrder: ['s:chat', 't:term', 'b:web', 'f:/a.ts'],
    activeCenterViewByWorktree: { [WT]: view },
    centerSplitByWorktree: {},
  })
}

describe('center split', () => {
  beforeEach(() => reset({ type: 'terminal', terminalId: 'term' }))

  it('has a single primary pane by default', () => {
    expect(getPaneLayout(WT)).toEqual({ panes: [{ id: 'primary', view: { type: 'terminal', terminalId: 'term' } }], focusedPaneId: 'primary' })
  })

  it('moving the shown tab to the secondary pane splits and falls back in the primary pane', () => {
    useUIStore.getState().moveTabToPane(WT, 't:term', 'secondary')
    const split = useUIStore.getState().centerSplitByWorktree[WT]
    expect(split.secondaryKeys).toEqual(['t:term'])
    expect(split.secondaryView).toEqual({ type: 'terminal', terminalId: 'term' })
    expect(split.focused).toBe('secondary')
    expect(useUIStore.getState().activeCenterViewByWorktree[WT]).toEqual({ type: 'browser', tabId: 'web' })
  })

  it('refuses to move chat sessions', () => {
    useUIStore.getState().moveTabToPane(WT, 's:chat', 'secondary')
    expect(useUIStore.getState().centerSplitByWorktree[WT]).toBeUndefined()
  })

  it('moving the last secondary tab back collapses the split', () => {
    const ui = useUIStore.getState()
    ui.moveTabToPane(WT, 'b:web', 'secondary')
    ui.moveTabToPane(WT, 'b:web', 'primary')
    expect(useUIStore.getState().centerSplitByWorktree[WT]).toBeUndefined()
    expect(useUIStore.getState().activeCenterViewByWorktree[WT]).toEqual({ type: 'browser', tabId: 'web' })
  })

  it('placeTabInPane opens beside (secondary) and activateKey targets the owning pane', () => {
    placeTabInPane(WT, 'b:web', 'secondary')
    expect(getFocusedView()).toEqual({ type: 'browser', tabId: 'web' })
    activateKey('t:term')
    expect(useUIStore.getState().centerSplitByWorktree[WT].focused).toBe('primary')
    expect(getFocusedView()).toEqual({ type: 'terminal', terminalId: 'term' })
  })

  it('persists and drops keys that are gone', () => {
    const ui = useUIStore.getState()
    ui.moveTabToPane(WT, 'b:web', 'secondary')
    ui.moveTabToPane(WT, 'f:/a.ts', 'secondary')
    ui.setSecondaryKeys(WT, ['f:/a.ts'])
    expect(useUIStore.getState().centerSplitByWorktree[WT].secondaryKeys).toEqual(['f:/a.ts'])
    ui.setSecondaryKeys(WT, [])
    expect(useUIStore.getState().centerSplitByWorktree[WT]).toBeUndefined()
  })

  it('closeSplit keeps the secondary view when it was focused', () => {
    const ui = useUIStore.getState()
    ui.moveTabToPane(WT, 'b:web', 'secondary')
    ui.closeSplit(WT)
    expect(useUIStore.getState().centerSplitByWorktree[WT]).toBeUndefined()
    expect(useUIStore.getState().activeCenterViewByWorktree[WT]).toEqual({ type: 'browser', tabId: 'web' })
  })
})
