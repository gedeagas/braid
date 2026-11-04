import { describe, it, expect, vi } from 'vitest'

vi.mock('../bigTerminalCache', () => ({ hibernateBigTerminal: vi.fn(), listBigTerminalActivity: vi.fn(() => []) }))

import { selectHibernationCandidates, clampHibernationMinutes } from '../agentHibernation'

const MIN = 60_000
const now = 100 * MIN

function input(overrides: Partial<Parameters<typeof selectHibernationCandidates>[0]> = {}) {
  return {
    now,
    idleMs: 30 * MIN,
    visibleTerminalId: 'bt-visible',
    resumableIds: new Set(['bt-idle', 'bt-visible', 'bt-busy', 'bt-typed', 'bt-phone', 'bt-restored']),
    statusById: {
      'bt-idle': { state: 'done', source: 'hook', agentType: 'claude' },
      'bt-visible': { state: 'done', source: 'hook' },
      'bt-busy': { state: 'working', source: 'hook' },
      'bt-typed': { state: 'done', source: 'hook' },
      'bt-phone': { state: 'done', source: 'hook' },
      'bt-restored': { state: 'done', source: 'restored' },
      'bt-noresume': { state: 'done', source: 'hook' },
    },
    terminals: [
      { terminalId: 'bt-idle', lastInputAt: now - 40 * MIN, lastOutputAt: now - 35 * MIN, mobileInputLocked: false },
      { terminalId: 'bt-visible', lastInputAt: 0, lastOutputAt: 0, mobileInputLocked: false },
      { terminalId: 'bt-busy', lastInputAt: 0, lastOutputAt: 0, mobileInputLocked: false },
      { terminalId: 'bt-typed', lastInputAt: now - 5 * MIN, lastOutputAt: 0, mobileInputLocked: false },
      { terminalId: 'bt-phone', lastInputAt: 0, lastOutputAt: 0, mobileInputLocked: true },
      { terminalId: 'bt-restored', lastInputAt: 0, lastOutputAt: 0, mobileInputLocked: false },
      { terminalId: 'bt-noresume', lastInputAt: 0, lastOutputAt: 0, mobileInputLocked: false },
    ],
    ...overrides,
  } as Parameters<typeof selectHibernationCandidates>[0]
}

describe('selectHibernationCandidates', () => {
  it('picks only finished, hidden, idle agents that can be resumed', () => {
    expect(selectHibernationCandidates(input())).toEqual([{ terminalId: 'bt-idle', agentType: 'claude' }])
  })

  it('waits until output has been quiet for the whole idle window', () => {
    const terminals = [{ terminalId: 'bt-idle', lastInputAt: 0, lastOutputAt: now - 10 * MIN, mobileInputLocked: false }]
    expect(selectHibernationCandidates(input({ terminals }))).toEqual([])
  })
})

describe('clampHibernationMinutes', () => {
  it('keeps the idle time between 1 minute and 24 hours', () => {
    expect(clampHibernationMinutes(0)).toBe(1)
    expect(clampHibernationMinutes(30)).toBe(30)
    expect(clampHibernationMinutes(5000)).toBe(1440)
    expect(clampHibernationMinutes(Number.NaN)).toBe(30)
  })
})
