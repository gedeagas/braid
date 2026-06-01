import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentHookStatus } from '../../agentHookServer'

// Capture the listener registered with onHookStatus so tests can drive it.
let registered: ((status: AgentHookStatus) => void) | null = null

vi.mock('../../agentHookServer', () => ({
  onHookStatus: (listener: (status: AgentHookStatus) => void) => {
    registered = listener
    return () => { registered = null }
  },
}))

vi.mock('../../pty', () => ({
  ptyService: {
    // One entry per test id (the module-level dedup map persists across tests,
    // so each test uses a distinct terminalId for isolation).
    listInstances: vi.fn(() => [
      { ptyId: 'p-done', cwd: '/work/wt', terminalId: 'bt-done', label: 'Claude Code', agentId: 'claude' },
      { ptyId: 'p-wait', cwd: '/work/wt', terminalId: 'bt-wait', label: 'Claude Code', agentId: 'claude' },
      { ptyId: 'p-work', cwd: '/work/wt', terminalId: 'bt-work', label: 'Claude Code', agentId: 'claude' },
      { ptyId: 'p-dd', cwd: '/work/wt', terminalId: 'bt-dd', label: 'Claude Code', agentId: 'claude' },
    ]),
  },
}))

const notifyMobile = vi.fn()
vi.mock('../../agent', () => ({
  agentService: { notifyMobile: (...args: unknown[]) => notifyMobile(...args) },
}))

vi.mock('../../storage', () => ({
  storageService: {
    load: () => ({ projects: [{ id: 'proj', name: 'braid', path: '/work' }] }),
  },
}))

vi.mock('../../git', () => ({
  gitService: {
    getWorktrees: vi.fn(async () => [{ path: '/work/wt', branch: 'feature-x', isMain: false }]),
  },
}))

const { startMobileTerminalNotifier } = await import('../terminalNotifier')

function fire(terminalId: string, state: AgentHookStatus['state']): void {
  registered?.({ terminalId, state, agentType: 'claude' })
}

// Location resolution awaits a git lookup, so notifyMobile fires on a later tick.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('mobile terminal notifier', () => {
  beforeEach(() => {
    notifyMobile.mockClear()
    startMobileTerminalNotifier()
  })

  it('pushes a mobile notification on done with project and worktree context', async () => {
    fire('bt-done', 'done')
    await flush()
    expect(notifyMobile).toHaveBeenCalledTimes(1)
    expect(notifyMobile).toHaveBeenCalledWith(expect.objectContaining({
      type: 'done',
      terminalId: 'bt-done',
      worktreePath: '/work/wt',
      projectName: 'braid',
      branch: 'feature-x',
      body: expect.stringContaining('braid / feature-x'),
    }))
    // The agent label still trails the location for context.
    expect(notifyMobile.mock.calls[0][0].body).toContain('Claude Code')
  })

  it('maps waiting to waiting_input', async () => {
    fire('bt-wait', 'waiting')
    await flush()
    expect(notifyMobile).toHaveBeenCalledWith(expect.objectContaining({ type: 'waiting_input' }))
  })

  it('ignores working states (no notification)', async () => {
    fire('bt-work', 'working')
    await flush()
    expect(notifyMobile).not.toHaveBeenCalled()
  })

  it('dedups repeated states but re-fires after returning to working', async () => {
    fire('bt-dd', 'done')
    fire('bt-dd', 'done')
    await flush()
    expect(notifyMobile).toHaveBeenCalledTimes(1)
    fire('bt-dd', 'working') // a new turn started
    fire('bt-dd', 'done')
    await flush()
    expect(notifyMobile).toHaveBeenCalledTimes(2)
  })
})
