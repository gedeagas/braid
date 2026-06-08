import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TaskReactions } from '../TaskReactions'
import type { PrIssueComment } from '../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function comment(overrides: Partial<PrIssueComment> = {}): PrIssueComment {
  return {
    id: 1,
    subjectId: 'IC_kwDO',
    author: 'reviewer',
    authorAvatarUrl: '',
    isBot: false,
    body: 'Looks good',
    createdAt: '2026-06-05T00:00:00Z',
    updatedAt: '2026-06-05T00:00:00Z',
    htmlUrl: '',
    reactions: [],
    ...overrides,
  }
}

describe('TaskReactions', () => {
  it('only renders the reaction menu while open', () => {
    render(
      <TaskReactions
        comment={comment()}
        reactingSubjectIds={new Set()}
        onToggleReaction={vi.fn()}
      />
    )

    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'reactions.addReaction' }))

    expect(screen.getByRole('menu', { name: 'reactions.chooseReaction' })).toBeDefined()
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)
  })
})
