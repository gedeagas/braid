import { describe, expect, it } from 'vitest'
import { getRepoQualifiers, parseTaskQuery, stripRepoQualifiers } from '../task-query'

describe('parseTaskQuery', () => {
  it('parses GitHub PR search qualifiers', () => {
    const parsed = parseTaskQuery('author:@me is:pr is:open label:"needs review"')

    expect(parsed).toMatchObject({
      scope: 'pr',
      state: 'open',
      author: '@me',
      labels: ['needs review'],
      freeText: '',
    })
  })

  it('forces PR scope for review-requested queries', () => {
    const parsed = parseTaskQuery('review-requested:@me is:open')

    expect(parsed.scope).toBe('pr')
    expect(parsed.state).toBe('open')
    expect(parsed.reviewRequested).toBe('@me')
  })

  it('preserves unknown qualifiers and quoted text as free text', () => {
    const parsed = parseTaskQuery('is:issue is:open repo:owner/name "exact phrase"')

    expect(parsed.scope).toBe('issue')
    expect(parsed.state).toBe('open')
    expect(parsed.freeText).toBe('repo:owner/name "exact phrase"')
  })

  it('strips repo qualifiers for cross-repo fan-out', () => {
    expect(stripRepoQualifiers('is:open repo:foo/bar label:"needs review"')).toBe('is:open label:"needs review"')
    expect(stripRepoQualifiers('REPO:Foo/Bar is:pr')).toBe('is:pr')
  })

  it('extracts repo qualifiers for renderer-side fan-out filtering', () => {
    expect(getRepoQualifiers('repo:foo/bar is:open repo:"baz/qux"')).toEqual(['foo/bar', 'baz/qux'])
  })
})
