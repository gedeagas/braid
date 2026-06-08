import { describe, expect, it } from 'vitest'
import { mapPrReviewComment, mapReactionGroups } from '../mappers'

describe('GitHub mappers', () => {
  it('ignores malformed reaction group entries', () => {
    expect(mapReactionGroups([
      null,
      'invalid',
      { content: 'HEART', reactors: { totalCount: 2 }, viewerHasReacted: true },
      { content: 'EYES', reactors: { totalCount: 0 }, viewerHasReacted: false },
    ])).toEqual([
      { content: 'HEART', count: 2, viewerHasReacted: true },
    ])
  })

  it('normalizes nullable review reply parent ids', () => {
    expect(mapPrReviewComment({ id: 1, in_reply_to_id: null }, new Map()).inReplyToId).toBeNull()
    expect(mapPrReviewComment({ id: 2 }, new Map()).inReplyToId).toBeNull()
    expect(mapPrReviewComment({ id: 3, in_reply_to_id: '42' }, new Map()).inReplyToId).toBe(42)
  })
})
