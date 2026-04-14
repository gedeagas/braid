import { describe, it, expect } from 'vitest'
import { buildLinkedWorktreeContext } from '../handlers/communicationHelpers'
import type { LinkedWorktree } from '@/types'

function makeLinked(overrides?: Partial<LinkedWorktree>): LinkedWorktree {
  return {
    worktreeId: 'wt-2',
    projectId: 'proj-1',
    projectName: 'MyProject',
    branch: 'feature/foo',
    path: '/home/user/repos/project',
    ...overrides
  }
}

describe('buildLinkedWorktreeContext', () => {
  // ── empty / nullish ────────────────────────────────────────────────────────

  it('returns undefined for undefined input', () => {
    expect(buildLinkedWorktreeContext(undefined)).toBeUndefined()
  })

  it('returns undefined for empty array', () => {
    expect(buildLinkedWorktreeContext([])).toBeUndefined()
  })

  // ── single entry ─────────────────────────────────────────────────────────

  it('formats a single entry with path, branch, and project', () => {
    const result = buildLinkedWorktreeContext([makeLinked()])
    expect(result).toBe('- /home/user/repos/project (branch: feature/foo, project: MyProject)')
  })

  it('uses the path as given (no normalization)', () => {
    const result = buildLinkedWorktreeContext([makeLinked({ path: '/a/b/c' })])
    expect(result).toContain('/a/b/c')
  })

  it('uses the branch as given', () => {
    const result = buildLinkedWorktreeContext([makeLinked({ branch: 'main' })])
    expect(result).toContain('branch: main')
  })

  it('uses the projectName as given', () => {
    const result = buildLinkedWorktreeContext([makeLinked({ projectName: 'Braid' })])
    expect(result).toContain('project: Braid')
  })

  // ── multiple entries ───────────────────────────────────────────────────────

  it('joins multiple entries with newlines', () => {
    const entries = [
      makeLinked({ path: '/repo/a', branch: 'main', projectName: 'Alpha' }),
      makeLinked({ path: '/repo/b', branch: 'feat', projectName: 'Beta' })
    ]
    const result = buildLinkedWorktreeContext(entries)
    const lines = result!.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('- /repo/a (branch: main, project: Alpha)')
    expect(lines[1]).toBe('- /repo/b (branch: feat, project: Beta)')
  })

  it('returns a string (not undefined) for non-empty arrays', () => {
    expect(typeof buildLinkedWorktreeContext([makeLinked()])).toBe('string')
  })

  // ── format consistency ────────────────────────────────────────────────────

  it('each line starts with "- "', () => {
    const result = buildLinkedWorktreeContext([
      makeLinked({ path: '/a' }),
      makeLinked({ path: '/b' })
    ])
    for (const line of result!.split('\n')) {
      expect(line.startsWith('- ')).toBe(true)
    }
  })
})
