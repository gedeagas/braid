import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentStatusEntry, updateAgentStatusEntry } from '../agentStatus'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('updateAgentStatusEntry', () => {
  it('ignores duplicate status payloads without refreshing updatedAt', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const entry = createAgentStatusEntry('working', 'codex')

    now.mockReturnValue(2000)
    const updated = updateAgentStatusEntry(entry, { state: 'working', agentType: 'codex' })

    expect(updated).toBe(entry)
    expect(updated.updatedAt).toBe(1000)
    expect(updated.stateHistory).toHaveLength(1)
  })

  it('updates metadata without treating it as a state transition', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const entry = createAgentStatusEntry('working', 'codex')

    now.mockReturnValue(2000)
    const updated = updateAgentStatusEntry(entry, {
      state: 'working',
      agentType: 'codex',
      toolName: 'Bash',
    })

    expect(updated).not.toBe(entry)
    expect(updated.updatedAt).toBe(1000)
    expect(updated.stateHistory).toHaveLength(1)
    expect(updated.toolName).toBe('Bash')
  })

  it('records real state transitions', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const entry = createAgentStatusEntry('working', 'codex')

    now.mockReturnValue(2000)
    const updated = updateAgentStatusEntry(entry, { state: 'waiting', agentType: 'codex' })

    expect(updated.updatedAt).toBe(2000)
    expect(updated.stateHistory).toEqual([
      { state: 'working', timestamp: 1000 },
      { state: 'waiting', timestamp: 2000 },
    ])
  })

  it('does not let title detection override a hook state', () => {
    const entry = createAgentStatusEntry('waiting', 'codex', 'hook')

    const updated = updateAgentStatusEntry(entry, {
      state: 'working',
      agentType: 'codex',
      source: 'title',
    })

    expect(updated).toBe(entry)
  })

  it('lets hook state override title detection', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const entry = createAgentStatusEntry('working', 'codex', 'title')

    now.mockReturnValue(2000)
    const updated = updateAgentStatusEntry(entry, {
      state: 'waiting',
      agentType: 'codex',
      source: 'hook',
    })

    expect(updated.state).toBe('waiting')
    expect(updated.source).toBe('hook')
    expect(updated.updatedAt).toBe(2000)
  })

  it('promotes the source without resetting timers when hook confirms the same state', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const entry = createAgentStatusEntry('working', 'codex', 'title')

    now.mockReturnValue(2000)
    const updated = updateAgentStatusEntry(entry, {
      state: 'working',
      agentType: 'codex',
      source: 'hook',
    })

    expect(updated).not.toBe(entry)
    expect(updated.source).toBe('hook')
    expect(updated.updatedAt).toBe(1000)
    expect(updated.stateHistory).toHaveLength(1)
  })
})
