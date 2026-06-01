import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentHookStatus } from '../../agentHookServer'

// Capture the listener registered with onHookStatus so tests can drive it.
let registered: ((status: AgentHookStatus) => void) | null = null

vi.mock('../../agentHookServer', () => ({
  onHookStatus: (listener: (status: AgentHookStatus) => void) => {
    registered = listener
    return () => { registered = null }
  },
}))

const { startTerminalActivityTracking, getTerminalActivity, clearTerminalActivity } = await import('../terminalActivity')

function fire(terminalId: string, state: AgentHookStatus['state']): void {
  registered?.({ terminalId, state, agentType: 'claude' })
}

describe('terminal activity tracker', () => {
  beforeEach(() => {
    startTerminalActivityTracking()
    // Module-level map persists across tests; each test uses a distinct id.
  })

  it('records the latest agent state per terminal', () => {
    fire('bt-1', 'waiting')
    expect(getTerminalActivity('bt-1')).toBe('waiting')
    fire('bt-1', 'done')
    expect(getTerminalActivity('bt-1')).toBe('done')
  })

  it('normalizes blocked to waiting', () => {
    fire('bt-2', 'blocked')
    expect(getTerminalActivity('bt-2')).toBe('waiting')
  })

  it('clears attention once the agent resumes working', () => {
    fire('bt-3', 'waiting')
    expect(getTerminalActivity('bt-3')).toBe('waiting')
    fire('bt-3', 'working')
    expect(getTerminalActivity('bt-3')).toBe('working')
  })

  it('returns undefined for unseen terminals and after clearing', () => {
    expect(getTerminalActivity('bt-unseen')).toBeUndefined()
    fire('bt-4', 'done')
    clearTerminalActivity('bt-4')
    expect(getTerminalActivity('bt-4')).toBeUndefined()
  })
})
