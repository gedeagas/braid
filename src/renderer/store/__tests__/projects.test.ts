import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Worktree } from '@/types'

const mocks = vi.hoisted(() => {
  const uiState = {
    selectedWorktreeId: 'wt-feature',
    bigTerminalsByWorktree: {
      'wt-feature': [{ id: 'bt-1' }],
    } as Record<string, Array<{ id: string }>>,
    selectWorktree: vi.fn(),
    clearBigTerminalsForWorktree: vi.fn(),
    cleanupWorktreeState: vi.fn(),
  }

  return {
    uiState,
    storageSave: vi.fn(),
    syncWorktreeIds: vi.fn(),
    getWorktrees: vi.fn(),
    getTrackingBranch: vi.fn(),
    removeGitWorktree: vi.fn(),
    runScript: vi.fn(),
    closeSessionsByWorktree: vi.fn(),
    cleanupWorktreeRefresh: vi.fn(),
    cleanupSetupPanel: vi.fn(),
    cleanupTerminals: vi.fn(),
    disposeBigTerminals: vi.fn(),
  }
})

vi.mock('@/lib/ipc', () => ({
  storage: {
    save: mocks.storageSave,
    syncWorktreeIds: mocks.syncWorktreeIds,
  },
  git: {
    getWorktrees: mocks.getWorktrees,
    getTrackingBranch: mocks.getTrackingBranch,
    removeWorktree: mocks.removeGitWorktree,
  },
  pty: {
    runScript: mocks.runScript,
  },
}))

vi.mock('@/store/ui', () => ({
  useUIStore: {
    getState: vi.fn(() => mocks.uiState),
  },
}))

vi.mock('@/store/sessions', () => ({
  useSessionsStore: {
    getState: vi.fn(() => ({
      closeSessionsByWorktree: mocks.closeSessionsByWorktree,
    })),
  },
}))

vi.mock('@/lib/worktreeRefresh', () => ({
  cleanupWorktreeRefresh: mocks.cleanupWorktreeRefresh,
}))

vi.mock('@/components/Right/SetupPanel', () => ({
  cleanupSetupPanel: mocks.cleanupSetupPanel,
}))

vi.mock('@/components/Right/TabbedTerminal', () => ({
  cleanupTerminals: mocks.cleanupTerminals,
}))

vi.mock('@/components/Center/bigTerminalCache', () => ({
  disposeBigTerminals: mocks.disposeBigTerminals,
}))

import { useProjectsStore } from '../projects'

const mainWorktree: Worktree = {
  id: 'wt-main',
  projectId: 'proj-1',
  branch: 'main',
  path: '/repo/main',
  isMain: true,
  sessions: [],
}

const featureWorktree: Worktree = {
  id: 'wt-feature',
  projectId: 'proj-1',
  branch: 'feature/delete-me',
  path: '/repo/wt/delete-me',
  isMain: false,
  sessions: [],
}

function makeProject(): Project {
  return {
    id: 'proj-1',
    name: 'repo',
    path: '/repo/main',
    worktrees: [mainWorktree, featureWorktree],
    createdAt: 1,
    settings: {
      workspacesPath: '',
      defaultBaseBranch: '',
      branchPrefix: '',
      remoteOrigin: '',
      setupScript: '',
      runScript: '',
      archiveScript: '',
      copyFiles: [],
      runFavorites: [],
      runCustomCommands: [],
      lspServers: [],
      lspDisabled: false,
    },
  }
}

function currentWorktreeIds(): string[] {
  return useProjectsStore.getState().projects[0]?.worktrees.map((w) => w.id) ?? []
}

describe('projects store removeWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    mocks.uiState.selectedWorktreeId = 'wt-feature'
    mocks.uiState.bigTerminalsByWorktree = {
      'wt-feature': [{ id: 'bt-1' }],
    }

    mocks.removeGitWorktree.mockResolvedValue(undefined)
    mocks.getWorktrees.mockResolvedValue([
      { path: mainWorktree.path, branch: mainWorktree.branch, isMain: true },
    ])
    mocks.getTrackingBranch.mockResolvedValue(null)

    useProjectsStore.setState({
      projects: [makeProject()],
      loading: false,
    })
  })

  it('keeps the worktree and renderer state when git removal fails', async () => {
    mocks.removeGitWorktree.mockRejectedValue(new Error('fatal: worktree is locked'))

    await expect(
      useProjectsStore.getState().removeWorktree('proj-1', 'wt-feature'),
    ).rejects.toThrow('fatal: worktree is locked')

    expect(currentWorktreeIds()).toEqual(['wt-main', 'wt-feature'])
    expect(mocks.cleanupTerminals).toHaveBeenCalledWith('/repo/wt/delete-me')
    expect(mocks.cleanupSetupPanel).toHaveBeenCalledWith('/repo/wt/delete-me')
    expect(mocks.closeSessionsByWorktree).not.toHaveBeenCalled()
    expect(mocks.cleanupWorktreeRefresh).not.toHaveBeenCalled()
    expect(mocks.disposeBigTerminals).not.toHaveBeenCalled()
    expect(mocks.uiState.cleanupWorktreeState).not.toHaveBeenCalled()
  })

  it('cleans renderer state only after git removal succeeds', async () => {
    await useProjectsStore.getState().removeWorktree('proj-1', 'wt-feature')

    expect(mocks.removeGitWorktree).toHaveBeenCalledWith('/repo/main', '/repo/wt/delete-me')
    expect(mocks.cleanupTerminals).toHaveBeenCalledWith('/repo/wt/delete-me')
    expect(mocks.cleanupSetupPanel).toHaveBeenCalledWith('/repo/wt/delete-me')
    expect(mocks.cleanupWorktreeRefresh).toHaveBeenCalledWith('/repo/wt/delete-me')
    expect(mocks.disposeBigTerminals).toHaveBeenCalledWith(['bt-1'])
    expect(mocks.uiState.clearBigTerminalsForWorktree).toHaveBeenCalledWith('wt-feature')
    expect(mocks.closeSessionsByWorktree).toHaveBeenCalledWith('wt-feature')
    expect(mocks.uiState.selectWorktree).toHaveBeenCalledWith('proj-1', 'wt-main')
    expect(mocks.uiState.cleanupWorktreeState).toHaveBeenCalledWith('wt-feature', '/repo/wt/delete-me')
    expect(currentWorktreeIds()).toEqual(['wt-main'])

    expect(mocks.cleanupTerminals.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeGitWorktree.mock.invocationCallOrder[0],
    )
  })
})
