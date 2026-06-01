import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentHookStatus } from '../agentHookServer'

// Capture the listener registered with onHookStatus so tests can drive it.
let registered: ((status: AgentHookStatus) => void) | null = null

vi.mock('../agentHookServer', () => ({
  onHookStatus: (listener: (status: AgentHookStatus) => void) => {
    registered = listener
    return () => { registered = null }
  },
}))

const addRunDuration = vi.fn()
vi.mock('../pty', () => ({
  ptyService: {
    addBigTerminalRunDuration: (...args: unknown[]) => addRunDuration(...args),
  },
}))

const { startTerminalRunTimer } = await import('../terminalRunTimer')

function fire(terminalId: string, state: AgentHookStatus['state']): void {
  registered?.({ terminalId, state, agentType: 'claude' })
}

describe('terminal run timer', () => {
  let now = 0
  beforeEach(() => {
    addRunDuration.mockClear()
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    startTerminalRunTimer()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accumulates the working span when the agent finishes', () => {
    fire('bt-a', 'working')
    now += 5_000
    fire('bt-a', 'done')
    expect(addRunDuration).toHaveBeenCalledTimes(1)
    expect(addRunDuration).toHaveBeenCalledWith('bt-a', 5_000)
  })

  it('does not reset the span on repeated working events (counts from first)', () => {
    fire('bt-b', 'working')
    now += 2_000
    fire('bt-b', 'working') // repeat - must not restart the clock
    now += 3_000
    fire('bt-b', 'waiting')
    expect(addRunDuration).toHaveBeenCalledTimes(1)
    expect(addRunDuration).toHaveBeenCalledWith('bt-b', 5_000)
  })

  it('ignores a non-working state with no open span', () => {
    fire('bt-c', 'done')
    expect(addRunDuration).not.toHaveBeenCalled()
  })

  it('measures each turn separately across working -> done -> working -> done', () => {
    fire('bt-d', 'working')
    now += 1_000
    fire('bt-d', 'done')
    fire('bt-d', 'working')
    now += 4_000
    fire('bt-d', 'done')
    expect(addRunDuration).toHaveBeenCalledTimes(2)
    expect(addRunDuration).toHaveBeenNthCalledWith(1, 'bt-d', 1_000)
    expect(addRunDuration).toHaveBeenNthCalledWith(2, 'bt-d', 4_000)
  })

  it('treats blocked/waiting as turn boundaries (clock stops while blocked)', () => {
    fire('bt-e', 'working')
    now += 2_000
    fire('bt-e', 'waiting') // agent paused for input - accumulate and stop
    now += 10_000           // user is slow to reply - must NOT be counted
    fire('bt-e', 'working') // user replied, new span begins
    now += 1_000
    fire('bt-e', 'done')
    expect(addRunDuration).toHaveBeenCalledTimes(2)
    expect(addRunDuration).toHaveBeenNthCalledWith(1, 'bt-e', 2_000)
    expect(addRunDuration).toHaveBeenNthCalledWith(2, 'bt-e', 1_000)
  })
})
