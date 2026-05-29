import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@/types'
import { ProjectList } from '../ProjectList'

const fetchPr = vi.fn().mockResolvedValue(undefined)

const project: Project = {
  id: 'proj-1',
  name: 'Project',
  path: '/repo/project',
  createdAt: 1,
  worktrees: [
    {
      id: 'wt-1',
      projectId: 'proj-1',
      branch: 'feature/pr',
      path: '/repo/project-feature-pr',
      isMain: false,
      sessions: [],
    },
  ],
}

const uiState = {
  projectOrder: [],
  reorderProjectsById: vi.fn(),
  expandedProjects: new Set(['proj-1']),
  toggleProject: vi.fn(),
  selectedWorktreeId: null,
  selectWorktree: vi.fn(),
  worktreeOrders: {},
  pinnedWorktrees: new Set<string>(),
  sidebarGroupBy: 'pr',
  sidebarSortBy: 'manual',
  sidebarFilterQuery: '',
  sidebarHideSleeping: false,
  sidebarHideDefaultBranch: false,
  clearSidebarFilters: vi.fn(),
  bigTerminalsByWorktree: {},
  bigTerminalStatusById: {},
}

const prCacheState = {
  cache: {
    '/repo/project-feature-pr': { data: null, fetchedAt: 123, loading: false },
  },
  fetchPr,
}

vi.mock('@/store/projects', () => ({
  useProjectsStore: vi.fn((selector: (state: { projects: Project[] }) => unknown) => selector({ projects: [project] })),
}))

vi.mock('@/store/ui', () => ({
  useUIStore: vi.fn((selector: (state: typeof uiState) => unknown) => selector(uiState)),
}))

vi.mock('@/store/sessions', () => ({
  useSessionsStore: vi.fn((selector: (state: { sessions: Record<string, unknown> }) => unknown) => selector({ sessions: {} })),
}))

vi.mock('@/store/prCache', () => ({
  usePrCacheStore: vi.fn((selector: (state: typeof prCacheState) => unknown) => selector(prCacheState)),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../WorktreeRow', () => ({ WorktreeRow: () => <div>worktree row</div> }))

describe('ProjectList PR refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('force-refreshes stale cached PR entries when entering PR grouping', async () => {
    render(<ProjectList onAddWorktree={vi.fn()} />)

    await waitFor(() => {
      expect(fetchPr).toHaveBeenCalledWith('/repo/project-feature-pr', { force: true })
    })
  })
})
