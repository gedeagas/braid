import { describe, it, expect, beforeEach } from 'vitest'
import { createBrowserTabsSlice, MAX_CLOSED_BROWSER_TABS, type BrowserTabsSlice } from '../browserTabs'
import type { UIState } from '../types'
import { SK } from '@/lib/storageKeys'

type ViewLike = { type: string; tabId?: string } | null

type SliceState = Pick<BrowserTabsSlice, 'browserTabsByWorktree' | 'closedBrowserTabsByWorktree' | 'browserRecentTabIds' | 'browserLoadingById'> & {
  activeCenterViewByWorktree: Record<string, ViewLike>
}

const WT = 'wt-1'
const OTHER = 'wt-2'

function makeSlice() {
  let state = {} as SliceState
  const get = () => state as unknown as UIState
  const set = (partial: Partial<UIState> | ((s: UIState) => Partial<UIState>)) => {
    const next = typeof partial === 'function' ? partial(state as unknown as UIState) : partial
    state = { ...state, ...next } as SliceState
  }
  const slice = createBrowserTabsSlice(set as never, get as never, {} as never)
  state = {
    browserTabsByWorktree: slice.browserTabsByWorktree,
    closedBrowserTabsByWorktree: slice.closedBrowserTabsByWorktree,
    browserRecentTabIds: slice.browserRecentTabIds,
    browserLoadingById: slice.browserLoadingById,
    activeCenterViewByWorktree: {},
  }
  return {
    actions: slice,
    tabs: (wt = WT) => state.browserTabsByWorktree[wt] ?? [],
    recent: () => state.browserRecentTabIds,
    loading: () => state.browserLoadingById,
    view: (wt = WT) => state.activeCenterViewByWorktree[wt],
    setView: (view: ViewLike, wt = WT) => {
      state = { ...state, activeCenterViewByWorktree: { ...state.activeCenterViewByWorktree, [wt]: view } }
    },
  }
}

describe('browserTabsSlice', () => {
  beforeEach(() => localStorage.clear())

  it('creates a tab with defaults and persists it', () => {
    const { actions, tabs } = makeSlice()
    const id = actions.createBrowserTab(WT, { url: 'http://localhost:3000/' })
    expect(id).toMatch(/^bw-/)
    expect(tabs()).toEqual([{ id, url: 'http://localhost:3000/', title: '', profileId: 'default' }])
    expect(JSON.parse(localStorage.getItem(SK.browserTabsPrefix + WT)!)).toHaveLength(1)
  })

  it('creates an empty new tab when no url is given', () => {
    const { actions, tabs } = makeSlice()
    actions.createBrowserTab(WT)
    expect(tabs()[0].url).toBe('')
  })

  it('hydrates persisted tabs for every worktree', () => {
    localStorage.setItem(SK.browserTabsPrefix + WT, JSON.stringify([{ id: 'a', url: 'https://a.com/', title: 'A' }]))
    localStorage.setItem(SK.browserTabsPrefix + OTHER, JSON.stringify([{ id: 'b', url: 'https://b.com/' }, { bogus: true }]))
    const { tabs } = makeSlice()
    expect(tabs()).toEqual([{ id: 'a', url: 'https://a.com/', title: 'A', profileId: 'default' }])
    expect(tabs(OTHER)).toEqual([{ id: 'b', url: 'https://b.com/', title: '', profileId: 'default' }])
  })

  it('updates a tab and ignores no-op patches', () => {
    const { actions, tabs } = makeSlice()
    const id = actions.createBrowserTab(WT)
    actions.updateBrowserTab(WT, id, { url: 'https://x.com/', title: 'X' })
    const before = tabs()
    actions.updateBrowserTab(WT, id, { title: 'X' })
    expect(tabs()).toBe(before)
    expect(tabs()[0]).toMatchObject({ url: 'https://x.com/', title: 'X' })
  })

  it('closing the active tab activates the adjacent browser tab', () => {
    const { actions, view, setView } = makeSlice()
    const a = actions.createBrowserTab(WT)
    const b = actions.createBrowserTab(WT)
    const c = actions.createBrowserTab(WT)
    setView({ type: 'browser', tabId: b })
    actions.closeBrowserTab(WT, b)
    expect(view()).toEqual({ type: 'browser', tabId: c })
    actions.closeBrowserTab(WT, c)
    expect(view()).toEqual({ type: 'browser', tabId: a })
    actions.closeBrowserTab(WT, a)
    expect(view()).toBeNull()
  })

  it('closing an inactive tab leaves the active view alone', () => {
    const { actions, view, setView } = makeSlice()
    const a = actions.createBrowserTab(WT)
    actions.createBrowserTab(WT)
    setView({ type: 'session', tabId: undefined })
    actions.closeBrowserTab(WT, a)
    expect(view()).toEqual({ type: 'session', tabId: undefined })
  })

  it('reopens closed tabs most-recent first at their old position', () => {
    const { actions, tabs } = makeSlice()
    const a = actions.createBrowserTab(WT, { url: 'https://a.com/' })
    const b = actions.createBrowserTab(WT, { url: 'https://b.com/' })
    actions.createBrowserTab(WT, { url: 'https://c.com/' })
    actions.closeBrowserTab(WT, a)
    actions.closeBrowserTab(WT, b)
    expect(actions.reopenClosedBrowserTab(WT)).toBe(b)
    expect(actions.reopenClosedBrowserTab(WT)).toBe(a)
    expect(tabs().map((t) => t.url)).toEqual(['https://a.com/', 'https://b.com/', 'https://c.com/'])
    expect(actions.reopenClosedBrowserTab(WT)).toBeNull()
  })

  it('caps the closed-tab stack', () => {
    const { actions } = makeSlice()
    const ids = Array.from({ length: MAX_CLOSED_BROWSER_TABS + 3 }, () => actions.createBrowserTab(WT))
    ids.forEach((id) => actions.closeBrowserTab(WT, id))
    let reopened = 0
    while (actions.reopenClosedBrowserTab(WT)) reopened++
    expect(reopened).toBe(MAX_CLOSED_BROWSER_TABS)
  })

  it('tracks most recently used tabs', () => {
    const { actions, recent } = makeSlice()
    const a = actions.createBrowserTab(WT)
    const b = actions.createBrowserTab(WT)
    actions.touchBrowserTab(a)
    actions.touchBrowserTab(b)
    actions.touchBrowserTab(a)
    expect(recent()).toEqual([a, b])
    actions.closeBrowserTab(WT, a)
    expect(recent()).toEqual([b])
  })

  it('tracks loading state and drops it on close', () => {
    const { actions, loading } = makeSlice()
    const a = actions.createBrowserTab(WT)
    actions.setBrowserTabLoading(a, true)
    expect(loading()).toEqual({ [a]: true })
    actions.closeBrowserTab(WT, a)
    expect(loading()).toEqual({})
  })

  it('clears a worktree', () => {
    const { actions, tabs } = makeSlice()
    actions.createBrowserTab(WT)
    actions.clearBrowserTabsForWorktree(WT)
    expect(tabs()).toEqual([])
    expect(localStorage.getItem(SK.browserTabsPrefix + WT)).toBeNull()
  })
})
