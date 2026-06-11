import { describe, expect, it } from 'vitest'
import { mergePrSummary, type PrSummaryLike } from '../pr-summary'

function prSummary(overrides: Partial<PrSummaryLike> = {}): PrSummaryLike {
  return {
    type: 'pr',
    number: 42,
    title: 'Improve task view',
    state: 'open',
    url: 'https://github.com/example/repo/pull/42',
    author: 'author',
    labels: ['bug'],
    assignees: ['dev'],
    updatedAt: '2026-06-06T00:00:00Z',
    ...overrides,
  }
}

describe('mergePrSummary', () => {
  it('returns the target object when the summary has no usable changes', () => {
    const target = prSummary({
      isDraft: false,
      headBranch: 'feature/task-view',
      baseBranch: 'main',
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      mergeStateStatus: 'CLEAN',
    })
    const summary = prSummary()

    expect(mergePrSummary(target, summary)).toBe(target)
  })

  it('preserves existing fields when the summary omits them', () => {
    const target = prSummary({
      updatedAt: '2026-06-05T00:00:00Z',
      isDraft: false,
      headBranch: 'feature/task-view',
      baseBranch: 'main',
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      mergeStateStatus: 'CLEAN',
    })
    const merged = mergePrSummary(target, prSummary({ updatedAt: '2026-06-06T00:00:00Z' }))

    expect(merged).not.toBe(target)
    expect(merged).toMatchObject({
      updatedAt: '2026-06-06T00:00:00Z',
      isDraft: false,
      headBranch: 'feature/task-view',
      baseBranch: 'main',
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      mergeStateStatus: 'CLEAN',
    })
  })
})
