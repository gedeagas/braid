import { describe, expect, it } from 'vitest'
import { detectAgentStatusFromTitle } from '../agentTitleDetection'

describe('detectAgentStatusFromTitle', () => {
  it('keeps the legacy Claude fallback for ambiguous braille spinners', () => {
    expect(detectAgentStatusFromTitle('⠋ Working')).toEqual({
      state: 'working',
      agentType: 'claude',
    })
  })

  it('uses the terminal agent for ambiguous braille spinners', () => {
    expect(detectAgentStatusFromTitle('⠋ Working', { expectedAgentType: 'codex' })).toEqual({
      state: 'working',
      agentType: 'codex',
    })
  })

  it('lets an explicit title agent override the terminal fallback', () => {
    expect(detectAgentStatusFromTitle('⠋ Claude Code', { expectedAgentType: 'codex' })).toEqual({
      state: 'working',
      agentType: 'claude',
    })
  })

  it('uses the terminal agent for generic waiting titles', () => {
    expect(detectAgentStatusFromTitle('? waiting for approval', { expectedAgentType: 'codex' })).toEqual({
      state: 'waiting',
      agentType: 'codex',
    })
  })
})
