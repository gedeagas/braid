import { describe, it, expect, beforeEach } from 'vitest'
import { createTerminalsSlice, selectBigTerminalsForActiveWorktree, type TerminalsSlice } from '../terminals'
import type { UIState } from '../types'
import { SK } from '@/lib/storageKeys'

// ---------------------------------------------------------------------------
// Minimal harness. The slice only reads/writes the bigTerminalsByWorktree
// field on UIState, so we stub out the other slice fields as `unknown as`
// casts. The slice's set() only merges partial state via spread, so a narrow
// record is enough.
// ---------------------------------------------------------------------------

type SliceState = { bigTerminalsByWorktree: TerminalsSlice['bigTerminalsByWorktree'] }

function makeSlice() {
  let state: SliceState
  const get = () => state as unknown as UIState
  const set = (partial: Partial<UIState> | ((s: UIState) => Partial<UIState>)) => {
    const next = typeof partial === 'function' ? partial(state as unknown as UIState) : partial
    state = { ...state, ...next } as SliceState
  }
  // Zustand `api` arg is not used inside the slice factory.
  const slice = createTerminalsSlice(set as never, get as never, {} as never)
  state = { bigTerminalsByWorktree: slice.bigTerminalsByWorktree }
  return {
    slice,
    read: () => state.bigTerminalsByWorktree,
    // Convenience to invoke actions; ensures get() sees latest state.
    actions: slice as TerminalsSlice,
  }
}

const WT = 'wt-abc'
const OTHER_WT = 'wt-xyz'

describe('terminalsSlice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('createBigTerminal', () => {
    it('appends a new terminal with a default label', () => {
      const { actions, read } = makeSlice()
      const id = actions.createBigTerminal(WT)
      expect(id).toMatch(/^bt-\d+-\d+$/)
      const list = read()[WT]
      expect(list).toHaveLength(1)
      expect(list![0]).toEqual({ id, label: 'Terminal 1' })
    })

    it('numbers successive labels by worktree', () => {
      const { actions, read } = makeSlice()
      actions.createBigTerminal(WT)
      actions.createBigTerminal(WT)
      const ids = read()[WT]!.map((t) => t.label)
      expect(ids).toEqual(['Terminal 1', 'Terminal 2'])
    })

    it('avoids duplicate labels after closing a middle terminal', () => {
      const { actions, read } = makeSlice()
      actions.createBigTerminal(WT)
      const b = actions.createBigTerminal(WT)
      actions.createBigTerminal(WT)
      // Close Terminal 2, then create a new one - should get Terminal 4, not another Terminal 3
      actions.closeBigTerminal(WT, b)
      actions.createBigTerminal(WT)
      const labels = read()[WT]!.map((t) => t.label)
      expect(labels).toEqual(['Terminal 1', 'Terminal 3', 'Terminal 4'])
    })

    it('accepts an explicit label override', () => {
      const { actions, read } = makeSlice()
      const id = actions.createBigTerminal(WT, 'claude')
      expect(read()[WT]!.find((t) => t.id === id)?.label).toBe('claude')
    })

    it('persists to localStorage under the per-worktree key', () => {
      const { actions } = makeSlice()
      const id = actions.createBigTerminal(WT)
      const raw = localStorage.getItem(SK.bigTerminalTabsPrefix + WT)
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!)
      expect(parsed).toEqual([{ id, label: 'Terminal 1' }])
    })

    it('keeps worktrees isolated', () => {
      const { actions, read } = makeSlice()
      const a = actions.createBigTerminal(WT)
      const b = actions.createBigTerminal(OTHER_WT)
      expect(read()[WT]!.map((t) => t.id)).toEqual([a])
      expect(read()[OTHER_WT]!.map((t) => t.id)).toEqual([b])
    })

    it('generates unique ids even within the same millisecond', () => {
      const { actions, read } = makeSlice()
      actions.createBigTerminal(WT)
      actions.createBigTerminal(WT)
      actions.createBigTerminal(WT)
      const ids = read()[WT]!.map((t) => t.id)
      expect(new Set(ids).size).toBe(3)
    })
  })

  describe('renameBigTerminal', () => {
    it('updates the label and persists', () => {
      const { actions, read } = makeSlice()
      const id = actions.createBigTerminal(WT)
      actions.renameBigTerminal(WT, id, 'deploy')
      expect(read()[WT]!.find((t) => t.id === id)?.label).toBe('deploy')
      const raw = JSON.parse(localStorage.getItem(SK.bigTerminalTabsPrefix + WT)!)
      expect(raw[0].label).toBe('deploy')
    })

    it('falls back to "Terminal" when trimmed label is empty', () => {
      const { actions, read } = makeSlice()
      const id = actions.createBigTerminal(WT)
      actions.renameBigTerminal(WT, id, '   ')
      expect(read()[WT]!.find((t) => t.id === id)?.label).toBe('Terminal')
    })

    it('is a no-op for unknown id', () => {
      const { actions, read } = makeSlice()
      const id = actions.createBigTerminal(WT, 'keep')
      actions.renameBigTerminal(WT, 'bt-does-not-exist', 'ignored')
      expect(read()[WT]!.find((t) => t.id === id)?.label).toBe('keep')
    })
  })

  describe('closeBigTerminal', () => {
    it('removes the terminal and persists', () => {
      const { actions, read } = makeSlice()
      const a = actions.createBigTerminal(WT)
      const b = actions.createBigTerminal(WT)
      actions.closeBigTerminal(WT, a)
      expect(read()[WT]!.map((t) => t.id)).toEqual([b])
      const raw = JSON.parse(localStorage.getItem(SK.bigTerminalTabsPrefix + WT)!)
      expect(raw.map((t: { id: string }) => t.id)).toEqual([b])
    })

    it('writes an empty array when the last tab closes', () => {
      const { actions, read } = makeSlice()
      const id = actions.createBigTerminal(WT)
      actions.closeBigTerminal(WT, id)
      expect(read()[WT]).toEqual([])
      expect(localStorage.getItem(SK.bigTerminalTabsPrefix + WT)).toBe('[]')
    })
  })

  describe('reorderBigTerminals', () => {
    it('moves a tab from one index to another', () => {
      const { actions, read } = makeSlice()
      const a = actions.createBigTerminal(WT)
      const b = actions.createBigTerminal(WT)
      const c = actions.createBigTerminal(WT)
      actions.reorderBigTerminals(WT, 0, 2)
      expect(read()[WT]!.map((t) => t.id)).toEqual([b, c, a])
    })

    it('ignores out-of-range indices', () => {
      const { actions, read } = makeSlice()
      const a = actions.createBigTerminal(WT)
      const b = actions.createBigTerminal(WT)
      actions.reorderBigTerminals(WT, 0, 99)
      expect(read()[WT]!.map((t) => t.id)).toEqual([a, b])
      actions.reorderBigTerminals(WT, -1, 0)
      expect(read()[WT]!.map((t) => t.id)).toEqual([a, b])
    })

    it('persists the new order', () => {
      const { actions } = makeSlice()
      const a = actions.createBigTerminal(WT)
      const b = actions.createBigTerminal(WT)
      actions.reorderBigTerminals(WT, 1, 0)
      const raw = JSON.parse(localStorage.getItem(SK.bigTerminalTabsPrefix + WT)!)
      expect(raw.map((t: { id: string }) => t.id)).toEqual([b, a])
    })
  })

  describe('restoreBigTerminalsForWorktree', () => {
    it('hydrates from localStorage for an unseen worktree', () => {
      localStorage.setItem(
        SK.bigTerminalTabsPrefix + WT,
        JSON.stringify([{ id: 'bt-1', label: 'one' }, { id: 'bt-2', label: 'two' }]),
      )
      const { actions, read } = makeSlice()
      actions.restoreBigTerminalsForWorktree(WT)
      expect(read()[WT]).toEqual([
        { id: 'bt-1', label: 'one' },
        { id: 'bt-2', label: 'two' },
      ])
    })

    it('does not overwrite already-hydrated state for this session', () => {
      const { actions, read } = makeSlice()
      actions.createBigTerminal(WT, 'live')
      // Simulate stale disk state — must be ignored since session has data.
      localStorage.setItem(
        SK.bigTerminalTabsPrefix + WT,
        JSON.stringify([{ id: 'bt-stale', label: 'stale' }]),
      )
      actions.restoreBigTerminalsForWorktree(WT)
      expect(read()[WT]!.map((t) => t.label)).toEqual(['live'])
    })

    it('handles malformed JSON by returning empty list', () => {
      localStorage.setItem(SK.bigTerminalTabsPrefix + WT, '{not-json')
      const { actions, read } = makeSlice()
      actions.restoreBigTerminalsForWorktree(WT)
      expect(read()[WT]).toEqual([])
    })

    it('filters non-object entries from persisted data', () => {
      localStorage.setItem(
        SK.bigTerminalTabsPrefix + WT,
        JSON.stringify([{ id: 'ok', label: 'good' }, null, 'str', { id: 'also', label: 'fine' }]),
      )
      const { actions, read } = makeSlice()
      actions.restoreBigTerminalsForWorktree(WT)
      expect(read()[WT]!.map((t) => t.id)).toEqual(['ok', 'also'])
    })
  })

  describe('clearBigTerminalsForWorktree', () => {
    it('removes both the slice entry and the localStorage key', () => {
      const { actions, read } = makeSlice()
      actions.createBigTerminal(WT)
      actions.clearBigTerminalsForWorktree(WT)
      expect(read()[WT]).toBeUndefined()
      expect(localStorage.getItem(SK.bigTerminalTabsPrefix + WT)).toBeNull()
    })

    it('leaves other worktrees untouched', () => {
      const { actions, read } = makeSlice()
      actions.createBigTerminal(WT)
      actions.createBigTerminal(OTHER_WT)
      actions.clearBigTerminalsForWorktree(WT)
      expect(read()[OTHER_WT]).toBeDefined()
      expect(localStorage.getItem(SK.bigTerminalTabsPrefix + OTHER_WT)).not.toBeNull()
    })
  })

  describe('initial hydration', () => {
    it('auto-loads persisted tabs for the last-selected worktree', () => {
      localStorage.setItem(SK.selectedWorktreeId, WT)
      localStorage.setItem(
        SK.bigTerminalTabsPrefix + WT,
        JSON.stringify([{ id: 'bt-saved', label: 'saved' }]),
      )
      const { read } = makeSlice()
      expect(read()[WT]).toEqual([{ id: 'bt-saved', label: 'saved' }])
    })

    it('starts with an empty record when no worktree is selected', () => {
      const { read } = makeSlice()
      expect(read()).toEqual({})
    })
  })

  describe('selectBigTerminalsForActiveWorktree', () => {
    it('returns tabs for the selected worktree', () => {
      const state = {
        selectedWorktreeId: WT,
        bigTerminalsByWorktree: { [WT]: [{ id: 'x', label: 'x' }] },
      } as unknown as UIState
      expect(selectBigTerminalsForActiveWorktree(state)).toEqual([{ id: 'x', label: 'x' }])
    })

    it('returns empty array when nothing is selected', () => {
      const state = {
        selectedWorktreeId: null,
        bigTerminalsByWorktree: {},
      } as unknown as UIState
      expect(selectBigTerminalsForActiveWorktree(state)).toEqual([])
    })

    it('returns empty array when the worktree has no terminals', () => {
      const state = {
        selectedWorktreeId: 'wt-empty',
        bigTerminalsByWorktree: { [WT]: [{ id: 'x', label: 'x' }] },
      } as unknown as UIState
      expect(selectBigTerminalsForActiveWorktree(state)).toEqual([])
    })
  })
})
