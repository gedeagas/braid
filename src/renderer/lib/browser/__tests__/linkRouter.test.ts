import { describe, it, expect } from 'vitest'
import { planLinkOpen, type LinkPlanInput } from '../linkRouter'

const base: LinkPlanInput = {
  url: 'http://localhost:3000/',
  routing: 'braid',
  invertWithShiftModifier: true,
  modifier: { shift: false, platformMod: false },
  worktreeId: 'wt',
  tabs: [],
  visibleBrowserTabIds: [],
  focusedBrowserTabId: null,
  recentTabIds: [],
  sourceKey: 't:term-1',
}

describe('planLinkOpen', () => {
  it('sends non-http links to the system', () => {
    expect(planLinkOpen({ ...base, url: 'mailto:a@b.c' })).toEqual({ kind: 'system' })
  })

  it('respects system routing and the shift inversion', () => {
    expect(planLinkOpen({ ...base, routing: 'system' })).toEqual({ kind: 'system' })
    expect(planLinkOpen({ ...base, modifier: { shift: true, platformMod: true } })).toEqual({ kind: 'system' })
    expect(planLinkOpen({ ...base, routing: 'system', modifier: { shift: true, platformMod: true } }).kind).toBe('newBeside')
    expect(planLinkOpen({ ...base, invertWithShiftModifier: false, modifier: { shift: true, platformMod: true } }).kind).toBe('newBeside')
  })

  it('falls back to the system without a worktree', () => {
    expect(planLinkOpen({ ...base, worktreeId: null })).toEqual({ kind: 'system' })
  })

  it('reuses a tab already showing the exact URL in the same profile', () => {
    const tabs = [{ id: 'a', url: 'http://localhost:3000/', profileId: 'default' }, { id: 'b', url: 'http://localhost:3000/', profileId: 'work' }]
    expect(planLinkOpen({ ...base, tabs })).toEqual({ kind: 'reuse', tabId: 'a' })
  })

  it('opens next to the focused visible browser tab, else the most recent visible one', () => {
    const tabs = [{ id: 'a', url: 'https://x/', profileId: 'default' }, { id: 'b', url: 'https://y/', profileId: 'default' }]
    expect(planLinkOpen({ ...base, tabs, visibleBrowserTabIds: ['a', 'b'], focusedBrowserTabId: 'b' })).toEqual({ kind: 'newAfter', tabId: 'b' })
    expect(planLinkOpen({ ...base, tabs, visibleBrowserTabIds: ['a', 'b'], recentTabIds: ['a', 'b'] })).toEqual({ kind: 'newAfter', tabId: 'a' })
  })

  it('opens beside the source when no browser is visible (hidden tabs do not attract links)', () => {
    const tabs = [{ id: 'a', url: 'https://x/', profileId: 'default' }]
    expect(planLinkOpen({ ...base, tabs })).toEqual({ kind: 'newBeside', sourceKey: 't:term-1' })
  })
})
