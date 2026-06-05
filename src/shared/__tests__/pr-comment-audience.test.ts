import { describe, expect, it } from 'vitest'
import {
  filterPRCommentsByAudience,
  getPRCommentAudienceCounts,
  isBotPRComment,
  type PRCommentAudienceItem,
} from '../pr-comment-audience'

function comment(overrides: Partial<PRCommentAudienceItem> = {}): PRCommentAudienceItem {
  return {
    author: 'user',
    ...overrides,
  }
}

describe('pr comment audience filtering', () => {
  it('uses provider bot metadata before falling back to login patterns', () => {
    expect(isBotPRComment(comment({ author: 'chatgpt-codex-connector', isBot: true }))).toBe(true)
    expect(isBotPRComment(comment({ author: 'github-actions[bot]' }))).toBe(true)
    expect(isBotPRComment(comment({ author: 'human-botany' }))).toBe(false)
  })

  it('counts and filters human and bot comments', () => {
    const comments = [
      comment({ author: 'yasinkavakli' }),
      comment({ author: 'chatgpt-codex-connector', isBot: true }),
      comment({ author: 'github-actions[bot]' }),
    ]

    expect(getPRCommentAudienceCounts(comments)).toEqual({ all: 3, human: 1, bot: 2 })
    expect(filterPRCommentsByAudience(comments, 'human').map((item) => item.author)).toEqual(['yasinkavakli'])
    expect(filterPRCommentsByAudience(comments, 'bot').map((item) => item.author)).toEqual([
      'chatgpt-codex-connector',
      'github-actions[bot]',
    ])
  })
})
