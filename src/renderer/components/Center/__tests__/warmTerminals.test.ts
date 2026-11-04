import { describe, it, expect, vi } from 'vitest'

vi.mock('../bigTerminalCache', () => ({ getOrCreate: vi.fn() }))

import { selectRestoredStatusSeeds, selectWarmTargets, warmableSessionIds } from '../warmTerminals'

describe('selectWarmTargets', () => {
  const paths = new Map([
    ['wt-a', '/repo/a'],
    ['wt-b', '/repo/b'],
  ])

  it('returns live terminals across all worktrees with their path and agent', () => {
    const targets = selectWarmTargets(
      {
        'wt-a': [{ id: 'bt-1', label: 'Claude', agentId: 'claude' }],
        'wt-b': [{ id: 'bt-2', label: 'Terminal 1' }],
      },
      paths,
      new Set(['bt-1', 'bt-2']),
    )
    expect(targets).toEqual([
      { terminalId: 'bt-1', worktreePath: '/repo/a', agentId: 'claude' },
      { terminalId: 'bt-2', worktreePath: '/repo/b', agentId: undefined },
    ])
  })

  it('skips terminals whose daemon session is gone', () => {
    const targets = selectWarmTargets(
      { 'wt-a': [{ id: 'bt-dead', label: 'Claude', agentId: 'claude' }] },
      paths,
      new Set(),
    )
    expect(targets).toEqual([])
  })

  it('skips worktrees that no longer exist', () => {
    const targets = selectWarmTargets(
      { 'wt-gone': [{ id: 'bt-1', label: 'Claude', agentId: 'claude' }] },
      paths,
      new Set(['bt-1']),
    )
    expect(targets).toEqual([])
  })
})

describe('warmableSessionIds', () => {
  it('leaves cold-restored sessions for when their tab is opened', () => {
    const ids = warmableSessionIds([
      { sessionId: 'bt-live' },
      { sessionId: 'bt-cold', coldRestored: true },
      { sessionId: 'bt-claimed', coldRestored: false },
    ])
    expect([...ids]).toEqual(['bt-live', 'bt-claimed'])
  })
})

describe('selectRestoredStatusSeeds', () => {
  const tabs = {
    'wt-a': [{ id: 'bt-cold', label: 'Claude' }, { id: 'bt-live', label: 'Codex' }],
    'wt-b': [{ id: 'bt-plain', label: 'Terminal' }],
  }

  it('shows the last-known agent for cold tabs that have a saved session', () => {
    const seeds = selectRestoredStatusSeeds(
      tabs,
      [
        { terminalId: 'bt-cold', session: { agent: 'claude' } },
        { terminalId: 'bt-live', session: { agent: 'codex' } },
        { terminalId: 'bt-closed', session: { agent: 'claude' } },
      ],
      new Set(['bt-live']),
    )
    // Live tabs are warmed (real status); closed tabs are not ours to show.
    expect(seeds).toEqual([{ terminalId: 'bt-cold', agentType: 'claude' }])
  })

  it('keeps unknown agent ids out of the agent type', () => {
    expect(selectRestoredStatusSeeds(tabs, [{ terminalId: 'bt-cold', session: { agent: 'mystery' } }], new Set()))
      .toEqual([{ terminalId: 'bt-cold' }])
  })
})
