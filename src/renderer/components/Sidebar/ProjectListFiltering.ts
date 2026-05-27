import type { Project, Worktree } from '@/types'
import { worktreeName } from '@/lib/branchValidation'

export function buildOrderedWorktrees(
  project: Project,
  worktreeOrders: Record<string, string[]>,
  pinnedWorktrees: Set<string>
): Worktree[] {
  const storedOrder = worktreeOrders[project.id]
  let base: Worktree[]
  if (storedOrder && storedOrder.length > 0) {
    const map = new Map(project.worktrees.map((w) => [w.id, w]))
    const result: Worktree[] = []
    for (const id of storedOrder) {
      const w = map.get(id)
      if (w) result.push(w)
    }
    for (const w of project.worktrees) {
      if (!result.includes(w)) result.push(w)
    }
    base = result
  } else {
    base = project.worktrees
  }
  return [...base].sort(
    (a, b) => (pinnedWorktrees.has(a.id) ? 0 : 1) - (pinnedWorktrees.has(b.id) ? 0 : 1)
  )
}

export interface SidebarFilterOptions {
  query: string
  hideSleeping: boolean
  hideDefaultBranch: boolean
  awakeWorktreeIds: Set<string>
  worktreeOrders: Record<string, string[]>
  pinnedWorktrees: Set<string>
}

export interface VisibleProject {
  project: Project
  worktrees: Worktree[]
}

interface SearchField {
  value: string | undefined
  weight: number
}

interface ScoredWorktree {
  worktree: Worktree
  score: number
}

interface ScoredProject {
  project: Project
  worktrees: Worktree[]
  score: number
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s._:/\\-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function fuzzyScore(text: string, token: string): number {
  if (token.length < 2) return 0
  let tokenIndex = 0
  let first = -1
  let last = -1

  for (let textIndex = 0; textIndex < text.length && tokenIndex < token.length; textIndex++) {
    if (text[textIndex] !== token[tokenIndex]) continue
    if (first === -1) first = textIndex
    last = textIndex
    tokenIndex++
  }

  if (tokenIndex !== token.length || first === -1) return 0
  const span = last - first + 1
  return Math.max(12, 42 - span)
}

function scoreField(raw: string | undefined, token: string): number {
  if (!raw) return 0
  const text = raw.toLowerCase()
  if (!text) return 0
  if (text === token) return 120
  if (text.startsWith(token)) return 105

  const segments = text.split(/[\s._:/\\-]+/).filter(Boolean)
  if (segments.some((segment) => segment === token)) return 95
  if (segments.some((segment) => segment.startsWith(token))) return 86

  const index = text.indexOf(token)
  if (index !== -1) return Math.max(52, 76 - Math.min(index, 48) / 2)

  const acronym = segments.map((segment) => segment[0]).join('')
  if (acronym.startsWith(token)) return 64
  if (acronym.includes(token)) return 54

  return fuzzyScore(text, token)
}

export function scoreSidebarSearch(fields: SearchField[], query: string): number {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return 0

  let total = 0
  for (const token of tokens) {
    let best = 0
    for (const field of fields) {
      const score = scoreField(field.value, token)
      if (score > 0) best = Math.max(best, score + field.weight)
    }
    if (best === 0) return 0
    total += best
  }
  return total
}

function scoreProject(project: Project, query: string): number {
  return scoreSidebarSearch([
    { value: project.name, weight: 45 },
    { value: project.path, weight: 8 },
  ], query)
}

function scoreWorktree(project: Project, worktree: Worktree, query: string): number {
  return scoreSidebarSearch([
    { value: worktreeName(worktree.path, worktree.branch), weight: 55 },
    { value: worktree.branch, weight: 50 },
    { value: project.name, weight: 35 },
    { value: worktree.path, weight: 8 },
    { value: project.path, weight: 5 },
  ], query)
}

export function buildVisibleProjects(
  projects: Project[],
  filters: SidebarFilterOptions
): VisibleProject[] {
  const query = filters.query.trim().toLowerCase()
  const hasQuery = query.length > 0
  const hasWorktreeFilters = filters.hideSleeping || filters.hideDefaultBranch

  if (!hasQuery && !hasWorktreeFilters) {
    return projects.map((project) => ({
      project,
      worktrees: buildOrderedWorktrees(project, filters.worktreeOrders, filters.pinnedWorktrees),
    }))
  }

  const visibleProjects: ScoredProject[] = []
  for (const project of projects) {
    const orderedWorktrees = buildOrderedWorktrees(project, filters.worktreeOrders, filters.pinnedWorktrees)
    const filteredWorktrees = orderedWorktrees.filter((worktree) => {
      if (filters.hideDefaultBranch && worktree.isMain) return false
      if (filters.hideSleeping && !filters.awakeWorktreeIds.has(worktree.id)) return false
      return true
    })

    const projectScore = hasQuery ? scoreProject(project, query) : 0
    const scoredWorktrees: ScoredWorktree[] = hasQuery
      ? filteredWorktrees
        .map((worktree) => ({
          worktree,
          score: Math.max(scoreWorktree(project, worktree, query), projectScore > 0 ? projectScore - 20 : 0),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
      : filteredWorktrees.map((worktree) => ({ worktree, score: 0 }))

    if (projectScore > 0 || scoredWorktrees.length > 0) {
      visibleProjects.push({
        project,
        worktrees: scoredWorktrees.map((entry) => entry.worktree),
        score: Math.max(projectScore, scoredWorktrees[0]?.score ?? 0),
      })
    }
  }

  if (hasQuery) visibleProjects.sort((a, b) => b.score - a.score)
  return visibleProjects.map(({ project, worktrees }) => ({ project, worktrees }))
}
