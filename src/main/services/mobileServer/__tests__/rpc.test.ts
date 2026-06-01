import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebSocket } from 'ws'
import type { MobileConnection, TrustedDevice, E2EESession, JsonRpcRequest } from '../types'

// Mock all service dependencies before importing rpc
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
}))

vi.mock('../../storage', () => ({
  storageService: {
    load: vi.fn(() => ({
      projects: [
        { id: 'p1', name: 'TestProject', path: '/test/path' },
      ],
    })),
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
    listInstances: vi.fn(() => [{ ptyId: 'pty-1', cwd: '/test' }]),
    write: vi.fn(),
    resize: vi.fn(),
    readTerminalOutput: vi.fn(() => []),
    onData: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
  },
}))

vi.mock('../../github', () => ({
  githubService: {
    getPrStatus: vi.fn(async () => null),
    getChecks: vi.fn(async () => []),
    getGitSyncStatus: vi.fn(async () => ({ ahead: 0, behind: 0 })),
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

  it('dispatches projects.list', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 2, method: 'projects.list' }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    const projects = res.result as Array<Record<string, unknown>>
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('TestProject')
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

  it('dispatches terminal.list', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 5, method: 'terminal.list', params: { worktreePath: '/test' } }
    const res = await dispatch(req, conn)
    expect(res.error).toBeUndefined()
    expect(res.result).toEqual([{ ptyId: 'pty-1', cwd: '/test' }])
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
  })
})
