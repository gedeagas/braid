import { describe, it, expect, vi } from 'vitest'

vi.mock('../bigTerminalCache', () => ({ getOrCreate: vi.fn() }))

import { selectWarmTargets } from '../warmTerminals'

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
