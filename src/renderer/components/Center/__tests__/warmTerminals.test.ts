import { describe, it, expect, vi } from 'vitest'

const { ui, pty } = vi.hoisted(() => ({
  ui: {
    bigTerminalsByWorktree: {} as Record<string, Array<{ id: string; label: string; agentId?: string }>>,
    seedRestoredBigTerminalStatus: vi.fn(),
  },
  pty: { listSessions: vi.fn(), listAgentSessions: vi.fn(), reattach: vi.fn(), registerBigTerminal: vi.fn(), setVisible: vi.fn() },
}))
const cache = vi.hoisted(() => ({ getOrCreate: vi.fn(), registerWarmBigTerminal: vi.fn(), hasBigTerminal: vi.fn((_id: string) => false), ensureBigTerminalStatusListeners: vi.fn() }))
vi.mock('../bigTerminalCache', () => cache)
const status = vi.hoisted(() => ({ applyTerminalStatus: vi.fn() }))
vi.mock('../bigTerminalStatus', () => status)
const features = vi.hoisted(() => ({ offload: false }))
vi.mock('@/lib/ptyFeatures', () => ({ initPtyFeatures: async () => {}, isOffloadEnabled: () => features.offload }))
vi.mock('@/lib/ipc', () => ({ pty }))
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ui } }))
vi.mock('@/store/projects', () => ({
  useProjectsStore: { getState: () => ({ projects: [{ worktrees: [{ id: 'wt-a', path: '/repo/a' }] }] }) },
}))

import { getOrCreate, registerWarmBigTerminal } from '../bigTerminalCache'
import { selectRestoredStatusSeeds, selectWarmTargets, warmableSessionIds, warmLiveBigTerminals } from '../warmTerminals'

describe('warmLiveBigTerminals', () => {
  it('reattaches only, and skips a tab closed while the session list was loading', async () => {
    ui.bigTerminalsByWorktree = { 'wt-a': [{ id: 'bt-1', label: 'A' }, { id: 'bt-2', label: 'B' }] }
    pty.listSessions.mockResolvedValue([{ sessionId: 'bt-1' }, { sessionId: 'bt-2' }])
    pty.listAgentSessions.mockImplementation(async () => {
      ui.bigTerminalsByWorktree = { 'wt-a': [{ id: 'bt-1', label: 'A' }] }
      return []
    })
    expect(await warmLiveBigTerminals()).toBe(1)
    expect(getOrCreate).toHaveBeenCalledTimes(1)
    expect(getOrCreate).toHaveBeenCalledWith('bt-1', '/repo/a', undefined, undefined, undefined, { reattachOnly: true })
  })
})

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

describe('warmLiveBigTerminals with a daemon that keeps screen state', () => {
  it('attaches in main only: no xterm, no WebGL, no raw snapshot; status from the daemon', async () => {
    vi.clearAllMocks()
    features.offload = true
    ui.bigTerminalsByWorktree = { 'wt-a': [{ id: 'bt-1', label: 'A', agentId: 'claude' }, { id: 'bt-2', label: 'B' }] }
    pty.listAgentSessions.mockResolvedValue([])
    pty.listSessions.mockResolvedValue([
      { sessionId: 'bt-1', agentStatus: { state: 'working', agentType: 'claude', source: 'hook' } },
      { sessionId: 'bt-2', coldRestored: true },
    ])
    pty.reattach.mockImplementation(async (id: string) => ({ sessionId: id, snapshot: '' }))

    expect(await warmLiveBigTerminals()).toBe(1)
    expect(getOrCreate).not.toHaveBeenCalled()
    expect(pty.reattach).toHaveBeenCalledWith('bt-1', { snapshot: false })
    // Cold-restored sessions still wait for their tab, as before.
    expect(pty.reattach).not.toHaveBeenCalledWith('bt-2', expect.anything())
    expect(pty.setVisible).toHaveBeenCalledWith('bt-1', false)
    expect(registerWarmBigTerminal).toHaveBeenCalledWith('bt-1', 'bt-1')
    expect(status.applyTerminalStatus).toHaveBeenCalledWith('bt-1', { state: 'working', source: 'hook', agentType: 'claude', toolName: undefined })
    features.offload = false
  })

  it('listens for agent status although no xterm is built', async () => {
    vi.clearAllMocks()
    features.offload = true
    ui.bigTerminalsByWorktree = {}
    pty.listAgentSessions.mockResolvedValue([])
    pty.listSessions.mockResolvedValue([])
    await warmLiveBigTerminals()
    expect(cache.ensureBigTerminalStatusListeners).toHaveBeenCalled()
    features.offload = false
  })

  it('leaves alone a terminal the user opened before or during its warm-up', async () => {
    vi.clearAllMocks()
    features.offload = true
    ui.bigTerminalsByWorktree = { 'wt-a': [{ id: 'bt-3', label: 'C' }, { id: 'bt-4', label: 'D' }] }
    pty.listAgentSessions.mockResolvedValue([])
    pty.listSessions.mockResolvedValue([{ sessionId: 'bt-3' }, { sessionId: 'bt-4' }])
    const opened = new Set(['bt-3'])
    cache.hasBigTerminal.mockImplementation((id: string) => opened.has(id))
    pty.reattach.mockImplementation(async (id: string) => {
      opened.add(id) // the user opens it while main attaches
      return { sessionId: id, snapshot: '' }
    })
    await warmLiveBigTerminals()
    expect(pty.reattach).not.toHaveBeenCalledWith('bt-3', expect.anything())
    expect(pty.reattach).toHaveBeenCalledWith('bt-4', { snapshot: false })
    expect(pty.setVisible).not.toHaveBeenCalled()
    expect(cache.registerWarmBigTerminal).not.toHaveBeenCalled()
    cache.hasBigTerminal.mockImplementation(() => false)
    features.offload = false
  })
})
