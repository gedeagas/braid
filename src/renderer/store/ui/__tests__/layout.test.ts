import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../store'
import { SK } from '@/lib/storageKeys'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Snapshot a few per-worktree maps that we want to guarantee untouched. */
function snapshot() {
  const s = useUIStore.getState()
  return {
    diffRevisionByWorktree: { ...s.diffRevisionByWorktree },
    changesOpenByWorktree: { ...s.changesOpenByWorktree },
    selectedDiffFileByWorktree: { ...s.selectedDiffFileByWorktree },
    activeCenterViewByWorktree: { ...s.activeCenterViewByWorktree },
    changesCounts: { ...s.changesCounts },
  }
}

beforeEach(() => {
  // Reset only the per-worktree maps we touch in these tests so we don't
  // bleed state across tests. We don't fully reset the store because that
  // would interfere with module-level localStorage initialization.
  useUIStore.setState({
    diffRevisionByWorktree: {},
    changesOpenByWorktree: {},
    selectedDiffFileByWorktree: {},
    activeCenterViewByWorktree: {},
    changesCounts: {},
  })
})

// ---------------------------------------------------------------------------
// bumpDiffRevision
// ---------------------------------------------------------------------------

describe('bumpDiffRevision', () => {
  it('initializes the counter to 1 on first bump', () => {
    useUIStore.getState().bumpDiffRevision('/path/to/wt-a')
    expect(useUIStore.getState().diffRevisionByWorktree['/path/to/wt-a']).toBe(1)
  })

  it('increments an existing counter monotonically', () => {
    const { bumpDiffRevision } = useUIStore.getState()
    bumpDiffRevision('/path/to/wt-a')
    bumpDiffRevision('/path/to/wt-a')
    bumpDiffRevision('/path/to/wt-a')
    expect(useUIStore.getState().diffRevisionByWorktree['/path/to/wt-a']).toBe(3)
  })

  it('keeps revisions independent across worktrees', () => {
    const { bumpDiffRevision } = useUIStore.getState()
    bumpDiffRevision('/path/to/wt-a')
    bumpDiffRevision('/path/to/wt-a')
    bumpDiffRevision('/path/to/wt-b')

    const map = useUIStore.getState().diffRevisionByWorktree
    expect(map['/path/to/wt-a']).toBe(2)
    expect(map['/path/to/wt-b']).toBe(1)
  })

  it('does not mutate the previous map reference', () => {
    useUIStore.getState().bumpDiffRevision('/path/to/wt-a')
    const before = useUIStore.getState().diffRevisionByWorktree
    useUIStore.getState().bumpDiffRevision('/path/to/wt-a')
    const after = useUIStore.getState().diffRevisionByWorktree
    // New reference each bump (Zustand consumers rely on this for re-renders)
    expect(after).not.toBe(before)
  })
})

// ---------------------------------------------------------------------------
// cleanupWorktreeState
// ---------------------------------------------------------------------------

describe('cleanupWorktreeState', () => {
  const WT_ID = 'wt-1'
  const WT_PATH = '/path/to/wt-1'

  function seed() {
    useUIStore.setState({
      diffRevisionByWorktree: { [WT_PATH]: 5, '/other/wt': 3 },
      changesOpenByWorktree: { [WT_ID]: true, 'wt-other': true },
      selectedDiffFileByWorktree: {
        [WT_ID]: { path: 'src/foo.ts', status: 'M', staged: true },
        'wt-other': { path: 'src/bar.ts', status: 'A', staged: false },
      },
      activeCenterViewByWorktree: {
        [WT_ID]: { type: 'changes' },
        'wt-other': { type: 'session', sessionId: 'sess-1' },
      },
      changesCounts: { [WT_PATH]: 7, '/other/wt': 2 },
    })
  }

  it('removes entries keyed by worktreeId', () => {
    seed()
    useUIStore.getState().cleanupWorktreeState(WT_ID, WT_PATH)
    const s = useUIStore.getState()
    expect(s.changesOpenByWorktree).not.toHaveProperty(WT_ID)
    expect(s.selectedDiffFileByWorktree).not.toHaveProperty(WT_ID)
    expect(s.activeCenterViewByWorktree).not.toHaveProperty(WT_ID)
  })

  it('removes entries keyed by worktreePath', () => {
    seed()
    useUIStore.getState().cleanupWorktreeState(WT_ID, WT_PATH)
    const s = useUIStore.getState()
    expect(s.changesCounts).not.toHaveProperty(WT_PATH)
    expect(s.diffRevisionByWorktree).not.toHaveProperty(WT_PATH)
  })

  it('preserves entries for other worktrees', () => {
    seed()
    useUIStore.getState().cleanupWorktreeState(WT_ID, WT_PATH)
    const s = useUIStore.getState()
    expect(s.changesOpenByWorktree['wt-other']).toBe(true)
    expect(s.selectedDiffFileByWorktree['wt-other']?.path).toBe('src/bar.ts')
    expect(s.activeCenterViewByWorktree['wt-other']).toEqual({ type: 'session', sessionId: 'sess-1' })
    expect(s.changesCounts['/other/wt']).toBe(2)
    expect(s.diffRevisionByWorktree['/other/wt']).toBe(3)
  })

  it('is a no-op when neither id nor path appears in any map', () => {
    seed()
    const before = snapshot()
    useUIStore.getState().cleanupWorktreeState('nonexistent-id', '/nonexistent/path')
    const after = snapshot()
    // Each map reference is preserved (no spurious set) when no key matches
    expect(after.diffRevisionByWorktree).toStrictEqual(before.diffRevisionByWorktree)
    expect(after.changesOpenByWorktree).toStrictEqual(before.changesOpenByWorktree)
    expect(after.selectedDiffFileByWorktree).toStrictEqual(before.selectedDiffFileByWorktree)
    expect(after.activeCenterViewByWorktree).toStrictEqual(before.activeCenterViewByWorktree)
    expect(after.changesCounts).toStrictEqual(before.changesCounts)
  })

  it('clears persisted localStorage entries for the worktree', () => {
    const filesKey = SK.openFilePathsPrefix + WT_ID
    const tabsKey = SK.tabOrderPrefix + WT_ID
    localStorage.setItem(filesKey, JSON.stringify(['a.ts']))
    localStorage.setItem(tabsKey, JSON.stringify(['changes']))
    // Sanity check
    expect(localStorage.getItem(filesKey)).not.toBeNull()
    useUIStore.getState().cleanupWorktreeState(WT_ID, WT_PATH)
    expect(localStorage.getItem(filesKey)).toBeNull()
    expect(localStorage.getItem(tabsKey)).toBeNull()
  })
})
