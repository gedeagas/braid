import { describe, expect, it } from 'vitest'
import type { Project, Worktree } from '@/types'
import { buildVisibleProjects, scoreSidebarSearch, type SidebarFilterOptions } from '../ProjectListFiltering'

function makeWorktree(projectId: string, id: string, branch: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id,
    projectId,
    branch,
    path: `/repos/${projectId}/${branch.replaceAll('/', '-')}`,
    isMain: false,
    sessions: [],
    ...overrides,
  }
}

function makeProject(id: string, name: string, worktrees: Worktree[]): Project {
  return {
    id,
    name,
    path: `/repos/${id}`,
    worktrees,
    createdAt: 1,
  }
}

function options(overrides: Partial<SidebarFilterOptions> = {}): SidebarFilterOptions {
  return {
    query: '',
    hideSleeping: false,
    hideDefaultBranch: false,
    awakeWorktreeIds: new Set(),
    worktreeOrders: {},
    pinnedWorktrees: new Set(),
    ...overrides,
  }
}

describe('buildVisibleProjects', () => {
  it('returns no projects when projects or filters are missing', () => {
    expect(buildVisibleProjects(undefined, options())).toEqual([])
    expect(buildVisibleProjects([], undefined)).toEqual([])
  })

  it('keeps all projects when no filters are active', () => {
    const alpha = makeProject('alpha', 'Alpha', [])
    const beta = makeProject('beta', 'Beta', [
      makeWorktree('beta', 'beta-main', 'main', { isMain: true }),
    ])

    const visible = buildVisibleProjects([alpha, beta], options())

    expect(visible.map((entry) => entry.project.id)).toEqual(['alpha', 'beta'])
    expect(visible[0].worktrees).toEqual([])
  })

  it('filters by worktree display name, branch, or path', () => {
    const alpha = makeProject('alpha', 'Alpha', [
      makeWorktree('alpha', 'alpha-main', 'main', { isMain: true }),
      makeWorktree('alpha', 'alpha-checkout', 'feature/cart-checkout'),
    ])
    const beta = makeProject('beta', 'Beta', [
      makeWorktree('beta', 'beta-search', 'feature/search'),
    ])

    const visible = buildVisibleProjects([alpha, beta], options({ query: 'checkout' }))

    expect(visible).toHaveLength(1)
    expect(visible[0].project.id).toBe('alpha')
    expect(visible[0].worktrees.map((worktree) => worktree.id)).toEqual(['alpha-checkout'])
  })

  it('matches query tokens across branch separators', () => {
    const alpha = makeProject('alpha', 'Alpha', [
      makeWorktree('alpha', 'alpha-cart', 'feature/cart-checkout-flow'),
      makeWorktree('alpha', 'alpha-profile', 'feature/profile'),
    ])

    const visible = buildVisibleProjects([alpha], options({ query: 'cart flow' }))

    expect(visible).toHaveLength(1)
    expect(visible[0].worktrees.map((worktree) => worktree.id)).toEqual(['alpha-cart'])
  })

  it('supports fuzzy acronym-style project matches', () => {
    const alpha = makeProject('alpha', 'React Native App', [
      makeWorktree('alpha', 'alpha-main', 'main', { isMain: true }),
    ])
    const beta = makeProject('beta', 'Backend API', [
      makeWorktree('beta', 'beta-main', 'main', { isMain: true }),
    ])

    const visible = buildVisibleProjects([alpha, beta], options({ query: 'rna' }))

    expect(visible.map((entry) => entry.project.id)).toEqual(['alpha'])
  })

  it('shows a matching project with its remaining worktrees', () => {
    const alpha = makeProject('alpha', 'Alpha Storefront', [
      makeWorktree('alpha', 'alpha-main', 'main', { isMain: true }),
      makeWorktree('alpha', 'alpha-feature', 'feature/cart'),
    ])

    const visible = buildVisibleProjects([alpha], options({
      query: 'storefront',
      hideDefaultBranch: true,
    }))

    expect(visible).toHaveLength(1)
    expect(visible[0].worktrees.map((worktree) => worktree.id)).toEqual(['alpha-feature'])
  })

  it('hides sleeping and default branch worktrees', () => {
    const alpha = makeProject('alpha', 'Alpha', [
      makeWorktree('alpha', 'alpha-main', 'main', { isMain: true }),
      makeWorktree('alpha', 'alpha-awake', 'feature/awake'),
      makeWorktree('alpha', 'alpha-sleeping', 'feature/sleeping'),
    ])

    const visible = buildVisibleProjects([alpha], options({
      hideSleeping: true,
      hideDefaultBranch: true,
      awakeWorktreeIds: new Set(['alpha-main', 'alpha-awake']),
    }))

    expect(visible).toHaveLength(1)
    expect(visible[0].worktrees.map((worktree) => worktree.id)).toEqual(['alpha-awake'])
  })
})

describe('scoreSidebarSearch', () => {
  it('requires every query token to match at least one field', () => {
    expect(scoreSidebarSearch([{ value: 'feature/cart-checkout', weight: 0 }], 'cart missing')).toBe(0)
  })

  it('prioritizes prefix matches over fuzzy matches', () => {
    const prefix = scoreSidebarSearch([{ value: 'cart checkout', weight: 0 }], 'cart')
    const fuzzy = scoreSidebarSearch([{ value: 'create review ticket', weight: 0 }], 'cart')

    expect(prefix).toBeGreaterThan(fuzzy)
  })
})
