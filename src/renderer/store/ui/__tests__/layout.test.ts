import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useUIStore } from '../store'
import { SK } from '@/lib/storageKeys'
import {
  ACTIVITY_BAR_WIDTH,
  RESIZE_HANDLE_WIDTH,
  CENTER_MIN_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
} from '@/lib/layoutConstants'

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

// ---------------------------------------------------------------------------
// setSidebarWidth - viewport-aware clamping
// ---------------------------------------------------------------------------

describe('setSidebarWidth', () => {
  const VIEWPORT = 1400

  beforeEach(() => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(VIEWPORT)
    useUIStore.setState({
      sidebarWidth: 290,
      rightPanelVisible: false,
      rightPanelWidth: 400,
      sidebarPanelOpen: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clamps to SIDEBAR_MIN_WIDTH when set below minimum', () => {
    useUIStore.getState().setSidebarWidth(100)
    expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('clamps to SIDEBAR_MAX_WIDTH when set above maximum', () => {
    useUIStore.getState().setSidebarWidth(800)
    expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('allows valid widths within the range', () => {
    useUIStore.getState().setSidebarWidth(350)
    expect(useUIStore.getState().sidebarWidth).toBe(350)
  })

  it('accounts for right panel width when visible', () => {
    useUIStore.setState({ rightPanelVisible: true, rightPanelWidth: 400 })
    // Max allowed = viewport - activityBar - centerMin - sidebarHandle - rightPanel - rightHandle
    const expectedMax = VIEWPORT - ACTIVITY_BAR_WIDTH - CENTER_MIN_WIDTH
      - RESIZE_HANDLE_WIDTH - 400 - RESIZE_HANDLE_WIDTH
    useUIStore.getState().setSidebarWidth(999)
    const result = useUIStore.getState().sidebarWidth
    expect(result).toBe(Math.min(SIDEBAR_MAX_WIDTH, expectedMax))
    // Center panel should have at least CENTER_MIN_WIDTH remaining
    const centerWidth = VIEWPORT - ACTIVITY_BAR_WIDTH - result
      - RESIZE_HANDLE_WIDTH - 400 - RESIZE_HANDLE_WIDTH
    expect(centerWidth).toBeGreaterThanOrEqual(CENTER_MIN_WIDTH)
  })

  it('accounts for both resize handles when both panels are open', () => {
    useUIStore.setState({ rightPanelVisible: true, rightPanelWidth: 400 })
    // Verify both handles (4px each = 8px total) are subtracted
    const reserved = ACTIVITY_BAR_WIDTH + CENTER_MIN_WIDTH
      + RESIZE_HANDLE_WIDTH + 400 + RESIZE_HANDLE_WIDTH
    const maxAllowed = Math.min(SIDEBAR_MAX_WIDTH, VIEWPORT - reserved)
    useUIStore.getState().setSidebarWidth(maxAllowed + 50)
    expect(useUIStore.getState().sidebarWidth).toBe(maxAllowed)
  })

  it('rounds fractional widths', () => {
    useUIStore.getState().setSidebarWidth(300.7)
    expect(useUIStore.getState().sidebarWidth).toBe(301)
  })
})

// ---------------------------------------------------------------------------
// setRightPanelWidth - viewport-aware clamping
// ---------------------------------------------------------------------------

describe('setRightPanelWidth', () => {
  const VIEWPORT = 1400

  beforeEach(() => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(VIEWPORT)
    useUIStore.setState({
      rightPanelWidth: 400,
      sidebarPanelOpen: false,
      sidebarWidth: 290,
      rightPanelVisible: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clamps to RIGHT_PANEL_MIN_WIDTH when set below minimum', () => {
    useUIStore.getState().setRightPanelWidth(100)
    expect(useUIStore.getState().rightPanelWidth).toBe(RIGHT_PANEL_MIN_WIDTH)
  })

  it('clamps to RIGHT_PANEL_MAX_WIDTH when set above maximum', () => {
    useUIStore.getState().setRightPanelWidth(900)
    expect(useUIStore.getState().rightPanelWidth).toBe(RIGHT_PANEL_MAX_WIDTH)
  })

  it('allows valid widths within the range', () => {
    useUIStore.getState().setRightPanelWidth(500)
    expect(useUIStore.getState().rightPanelWidth).toBe(500)
  })

  it('accounts for sidebar width when open', () => {
    useUIStore.setState({ sidebarPanelOpen: true, sidebarWidth: 290 })
    const expectedMax = VIEWPORT - ACTIVITY_BAR_WIDTH - CENTER_MIN_WIDTH
      - RESIZE_HANDLE_WIDTH - 290 - RESIZE_HANDLE_WIDTH
    useUIStore.getState().setRightPanelWidth(999)
    const result = useUIStore.getState().rightPanelWidth
    expect(result).toBe(Math.min(RIGHT_PANEL_MAX_WIDTH, expectedMax))
    const centerWidth = VIEWPORT - ACTIVITY_BAR_WIDTH - 290
      - RESIZE_HANDLE_WIDTH - result - RESIZE_HANDLE_WIDTH
    expect(centerWidth).toBeGreaterThanOrEqual(CENTER_MIN_WIDTH)
  })

  it('accounts for both resize handles when sidebar is open', () => {
    useUIStore.setState({ sidebarPanelOpen: true, sidebarWidth: 290 })
    const reserved = ACTIVITY_BAR_WIDTH + CENTER_MIN_WIDTH
      + RESIZE_HANDLE_WIDTH + 290 + RESIZE_HANDLE_WIDTH
    const maxAllowed = Math.min(RIGHT_PANEL_MAX_WIDTH, VIEWPORT - reserved)
    useUIStore.getState().setRightPanelWidth(maxAllowed + 50)
    expect(useUIStore.getState().rightPanelWidth).toBe(maxAllowed)
  })

  it('rounds fractional widths', () => {
    useUIStore.getState().setRightPanelWidth(450.3)
    expect(useUIStore.getState().rightPanelWidth).toBe(450)
  })
})

// ---------------------------------------------------------------------------
// reclampPanelWidths - re-clamp on viewport change
// ---------------------------------------------------------------------------

describe('reclampPanelWidths', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shrinks sidebar when viewport gets smaller', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    useUIStore.setState({
      sidebarPanelOpen: true,
      sidebarWidth: 450,
      rightPanelVisible: true,
      rightPanelWidth: 300,
    })
    useUIStore.getState().reclampPanelWidths()
    const s = useUIStore.getState()
    const centerWidth = 800 - ACTIVITY_BAR_WIDTH - s.sidebarWidth
      - RESIZE_HANDLE_WIDTH - s.rightPanelWidth - RESIZE_HANDLE_WIDTH
    expect(centerWidth).toBeGreaterThanOrEqual(CENTER_MIN_WIDTH)
  })

  it('does not change widths when viewport is large enough', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(2000)
    useUIStore.setState({
      sidebarPanelOpen: true,
      sidebarWidth: 290,
      rightPanelVisible: true,
      rightPanelWidth: 400,
    })
    useUIStore.getState().reclampPanelWidths()
    const s = useUIStore.getState()
    expect(s.sidebarWidth).toBe(290)
    expect(s.rightPanelWidth).toBe(400)
  })

  it('skips sidebar clamp when sidebar is closed', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(600)
    useUIStore.setState({
      sidebarPanelOpen: false,
      sidebarWidth: 500,
      rightPanelVisible: true,
      rightPanelWidth: 400,
    })
    useUIStore.getState().reclampPanelWidths()
    // Sidebar width is untouched since sidebar is closed
    expect(useUIStore.getState().sidebarWidth).toBe(500)
  })

  it('skips right panel clamp when right panel is hidden', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(600)
    useUIStore.setState({
      sidebarPanelOpen: true,
      sidebarWidth: 200,
      rightPanelVisible: false,
      rightPanelWidth: 600,
    })
    useUIStore.getState().reclampPanelWidths()
    // Right panel width is untouched since panel is hidden
    expect(useUIStore.getState().rightPanelWidth).toBe(600)
  })

  it('persists clamped values to localStorage', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(700)
    useUIStore.setState({
      sidebarPanelOpen: true,
      sidebarWidth: 400,
      rightPanelVisible: false,
      rightPanelWidth: 400,
    })
    useUIStore.getState().reclampPanelWidths()
    const stored = localStorage.getItem(SK.sidebarWidth)
    expect(stored).toBe(String(useUIStore.getState().sidebarWidth))
  })
})
