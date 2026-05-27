import { describe, expect, it } from 'vitest'
import { isCodexUserInputPromptText } from '../codexTerminalDetection'

describe('isCodexUserInputPromptText', () => {
  it('detects the Codex request_user_input question pane', () => {
    expect(isCodexUserInputPromptText([
      'Questions 0/1 answered',
      'Question 1/1 (1 unanswered)',
      'option 1/2 [ ] Continue',
      'Submit with 1 unanswered question',
    ].join('\n'))).toBe(true)
  })

  it('detects a fully answered question that still needs submit', () => {
    expect(isCodexUserInputPromptText([
      'Questions 1/1 answered',
      'Question 1/1',
      'answer: use the existing notification path',
      'ctrl+s to submit all',
    ].join('\n'))).toBe(true)
  })

  it('ignores interrupted transcript text that is no longer an active prompt', () => {
    expect(isCodexUserInputPromptText([
      'Questions (interrupted)',
      '  - (unanswered)',
      '    answer:',
    ].join('\n'))).toBe(false)
  })

  it('ignores ordinary command output mentioning questions', () => {
    expect(isCodexUserInputPromptText('FAQ: questions answered in the README')).toBe(false)
  })
})
