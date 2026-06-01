import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebSocket } from 'ws'
import type { MobileConnection, TrustedDevice, E2EESession, JsonRpcRequest } from '../types'

// Mock all service dependencies before importing rpc
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../../storage', () => ({
  storageService: {
    load: vi.fn(() => ({
      projects: [
        { id: 'p1', name: 'TestProject', path: '/test/path' },
      ],
    })),
    loadWorktreeIds: vi.fn(() => ({ '/test/wt': 'p1-wt-test/wt-1' })),
  },
}))

vi.mock('../../git', () => ({
  gitService: {
    getWorktrees: vi.fn(async () => [{ path: '/test/wt', branch: 'main' }]),
    getStatus: vi.fn(async () => []),
    getDiff: vi.fn(async () => ''),
    getFileDiff: vi.fn(async () => 'diff output'),
    getBranches: vi.fn(async () => ['main', 'dev']),
    stageFiles: vi.fn(async () => {}),
    unstageFiles: vi.fn(async () => {}),
    discardChanges: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    pull: vi.fn(async () => ({ alreadyUpToDate: false })),
    addWorktree: vi.fn(async () => {}),
    removeWorktree: vi.fn(async () => {}),
  },
}))

vi.mock('../../agent', () => ({
  agentService: {
    startSession: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    stopSession: vi.fn(async () => {}),
    answerToolInput: vi.fn(),
    answerElicitation: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}))

vi.mock('../../pty', () => ({
  ptyService: {
    listInstances: vi.fn(() => [
      // Center-panel/mobile big terminal - should be surfaced to mobile.
      { ptyId: 'pty-1', cwd: '/test', terminalId: 'bt-100-1', label: 'Claude', agentId: 'claude' },
      // Right-side-panel terminal - never registered, so terminalId undefined.
      { ptyId: 'pty-2', cwd: '/test' },
      // Orphaned big terminal - metadata removed on close, so no label. Must be
      // filtered out: it is a closed/zombie session the desktop no longer shows.
      { ptyId: 'pty-3', cwd: '/test', terminalId: 'bt-100-3' },
    ]),
    write: vi.fn(),
    resize: vi.fn(),
    getSize: vi.fn(() => ({ cols: 120, rows: 40 })),
    onResize: vi.fn(() => () => {}),
    readTerminalOutput: vi.fn(() => []),
    onData: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
    spawn: vi.fn(async () => 'pty-new'),
    registerBigTerminal: vi.fn(),
    setBigTerminalMetadata: vi.fn(),
    killBigTerminal: vi.fn(),
    kill: vi.fn(),
  },
}))

vi.mock('../../github', () => ({
  githubService: {
    getPrStatus: vi.fn(async () => null),
    getChecks: vi.fn(async () => []),
    getGitSyncStatus: vi.fn(async () => ({ ahead: 0, behind: 0 })),
  },
}))

vi.mock('../../rateLimits/service', () => ({
  rateLimitService: {
    getState: vi.fn(() => ({
      claude: { provider: 'claude', session: { usedPercent: 20, windowMinutes: 300, resetsAt: null, resetDescription: null }, weekly: null, updatedAt: 1000, error: null, status: 'ok' },
      codex: null,
    })),
    refresh: vi.fn(async () => ({ claude: null, codex: null })),
  },
}))

vi.mock('../../sessionStorage', () => ({
  sessionStorageService: {
    loadAllSessions: vi.fn(() => [
      {
        id: 's1', worktreeId: 'wt1', name: 'Test Session', customName: false,
        status: 'idle', model: 'claude-sonnet-4-6', createdAt: 1000,
        worktreePath: '/test', messages: [{ role: 'user' }],
      },
    ]),
  },
}))

function makeConnection(): MobileConnection {
  const ws = {
    emit: vi.fn(),
    readyState: 1,
  } as unknown as WebSocket

  return {
    ws,
    device: { id: 'd1', name: 'Test Device' } as TrustedDevice,
    e2ee: {} as E2EESession,
    subscriptions: new Map(),
    connectedAt: Date.now(),
    sendQueue: Promise.resolve(),
  }
}

// Import after mocks
const { dispatch, getMethodNames } = await import('../rpc')

describe('RPC Dispatch', () => {
  let conn: MobileConnection

  beforeEach(() => {
    conn = makeConnection()
  })

  it('returns method not found for unknown method', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'nonexistent.method' }
    const res = await dispatch(req, conn)
    expect(res.error).toBeDefined()
    expect(res.error!.code).toBe(-32601)
    expect(res.error!.message).toContain('nonexistent.method')
  })

  it('dispatches status.get', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'status.get' }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    expect(res.result).toBeDefined()
    const result = res.result as Record<string, unknown>
    expect(result.version).toBe('1.0.0')
    expect(result.protocolVersion).toBe(2)
    expect(result.projects).toHaveLength(1)
  })

  it('dispatches rateLimits.get with the desktop cached usage', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 50, method: 'rateLimits.get' }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    const state = res.result as { claude: Record<string, unknown> | null; codex: unknown }
    expect(state.claude?.status).toBe('ok')
    expect((state.claude?.session as Record<string, unknown>).windowMinutes).toBe(300)
    expect(state.codex).toBeNull()
  })

  it('dispatches projects.list', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 2, method: 'projects.list' }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    const projects = res.result as Array<Record<string, unknown>>
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('TestProject')
    // Worktrees carry the desktop's stable id so mobile-created terminals bind.
    const worktrees = projects[0].worktrees as Array<Record<string, unknown>>
    expect(worktrees[0].id).toBe('p1-wt-test/wt-1')
  })

  it('terminal.create resolves worktreeId from the registry when client omits it', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0', id: 99, method: 'terminal.create',
      params: { worktreePath: '/test/wt', agentId: 'claude' },
    }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    const result = res.result as Record<string, unknown>
    expect(result.terminalId).toMatch(/^bt-/)
    // Falls back to loadWorktreeIds()['/test/wt'] so the desktop can bind it.
    expect(result.worktreeId).toBe('p1-wt-test/wt-1')
  })

  it('terminal.close kills the big terminal by its id (reaps PTY + metadata)', async () => {
    const { ptyService } = await import('../../pty')
    vi.mocked(ptyService.killBigTerminal!).mockClear()
    vi.mocked(ptyService.kill).mockClear()
    const req: JsonRpcRequest = {
      jsonrpc: '2.0', id: 30, method: 'terminal.close',
      params: { terminalId: 'bt-100-1', ptyId: 'pty-1' },
    }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    expect(res.result).toEqual({ closed: true })
    expect(ptyService.killBigTerminal!).toHaveBeenCalledWith('bt-100-1')
    expect(ptyService.kill).not.toHaveBeenCalled()
  })

  it('terminal.close falls back to a raw PTY kill when only ptyId is given', async () => {
    const { ptyService } = await import('../../pty')
    vi.mocked(ptyService.killBigTerminal!).mockClear()
    vi.mocked(ptyService.kill).mockClear()
    const req: JsonRpcRequest = {
      jsonrpc: '2.0', id: 31, method: 'terminal.close', params: { ptyId: 'pty-2' },
    }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    expect(ptyService.kill).toHaveBeenCalledWith('pty-2')
    expect(ptyService.killBigTerminal!).not.toHaveBeenCalled()
  })

  it('terminal.close errors when neither terminalId nor ptyId is provided', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 32, method: 'terminal.close', params: {} }
    const res = await dispatch(req, conn)
    expect(res.error).toBeDefined()
  })

  it('dispatches sessions.list without full messages', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 3, method: 'sessions.list' }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    const sessions = res.result as Array<Record<string, unknown>>
    expect(sessions).toHaveLength(1)
    expect(sessions[0].messageCount).toBe(1)
    expect(sessions[0]).not.toHaveProperty('messages')
  })

  it('dispatches git.status', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 4, method: 'git.status', params: { worktreePath: '/test' } }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    expect(res.result).toEqual([])
  })

  it('dispatches terminal.list and excludes non big terminals and orphans', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 5, method: 'terminal.list', params: { worktreePath: '/test' } }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    const terminals = res.result as Array<Record<string, unknown>>
    // Only the labelled bt- big terminal is surfaced; the right-panel terminal
    // (no terminalId) and the orphaned bt- terminal (no label) are filtered out.
    expect(terminals).toHaveLength(1)
    expect(terminals[0].ptyId).toBe('pty-1')
    expect(terminals[0].terminalId).toBe('bt-100-1')
  })

  it('handles errors in handlers gracefully', async () => {
    const { gitService } = await import('../../git')
    vi.mocked(gitService.getStatus).mockRejectedValueOnce(new Error('git exploded'))

    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 6, method: 'git.status', params: { worktreePath: '/test' } }
    const res = await dispatch(req, conn)
    expect(res.error).toBeDefined()
    expect(res.error!.code).toBe(-32603)
    expect(res.error!.message).toContain('git exploded')
  })

  it('creates and removes agent subscriptions', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 7, method: 'agent.subscribe', params: {} }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    const result = res.result as { subscriptionId: string }
    expect(result.subscriptionId).toMatch(/^sub-/)

    // Check subscription was registered
    expect(conn.subscriptions.size).toBe(1)

    // Unsubscribe
    const unsubReq: JsonRpcRequest = {
      jsonrpc: '2.0', id: 8, method: 'agent.unsubscribe',
      params: { subscriptionId: result.subscriptionId },
    }
    await dispatch(unsubReq, conn)
    expect(conn.subscriptions.size).toBe(0)
  })

  it('returns the correct response id', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 42, method: 'status.get' }
    const res = await dispatch(req, conn)
    expect(res.id).toBe(42)
  })

  it('registers expected method names', () => {
    const names = getMethodNames()
    expect(names).toContain('status.get')
    expect(names).toContain('projects.list')
    expect(names).toContain('sessions.list')
    expect(names).toContain('git.status')
    expect(names).toContain('github.prStatus')
    expect(names).toContain('terminal.list')
    expect(names).toContain('agent.subscribe')
    expect(names).toContain('terminal.setDisplayMode')
  })

  it('terminal.setDisplayMode desktop reports the mode and does not phone-fit', async () => {
    const { ptyService } = await import('../../pty')
    vi.mocked(ptyService.resize).mockClear()
    const req: JsonRpcRequest = {
      jsonrpc: '2.0', id: 20, method: 'terminal.setDisplayMode',
      params: { ptyId: 'pty-1', mode: 'desktop' },
    }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    const result = res.result as Record<string, unknown>
    expect(result.displayMode).toBe('desktop')
    // Desktop mode never resizes the PTY to the phone viewport; the desktop drives it.
    expect(ptyService.resize).not.toHaveBeenCalled()
  })

  it('terminal.setDisplayMode phone resizes the PTY to the reported viewport', async () => {
    const { ptyService } = await import('../../pty')
    vi.mocked(ptyService.resize).mockClear()
    const req: JsonRpcRequest = {
      jsonrpc: '2.0', id: 21, method: 'terminal.setDisplayMode',
      params: { ptyId: 'pty-1', mode: 'phone', viewport: { cols: 40, rows: 24 } },
    }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    expect((res.result as Record<string, unknown>).displayMode).toBe('phone')
    expect(ptyService.resize).toHaveBeenCalledWith('pty-1', 40, 24)
  })

  it('terminal.subscribe streams resize events and emits the current size', async () => {
    const { ptyService } = await import('../../pty')
    const req: JsonRpcRequest = {
      jsonrpc: '2.0', id: 22, method: 'terminal.subscribe', params: { ptyId: 'pty-1' },
    }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    // It wires a resize listener so desktop-mode dimension changes reach the phone.
    expect(ptyService.onResize).toHaveBeenCalledWith('pty-1', expect.any(Function))
    // And pushes the current dimensions once so a reconnecting device is in sync.
    expect(conn.ws.emit).toHaveBeenCalledWith('rpc:notification', expect.objectContaining({
      method: 'terminal.resized',
      params: expect.objectContaining({ ptyId: 'pty-1', cols: 120, rows: 40 }),
    }))
  })
})
