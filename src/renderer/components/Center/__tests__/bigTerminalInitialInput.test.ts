import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const events: string[] = []
let dataCb: ((id: string, data: string) => void) | null = null
vi.mock('@/lib/ipc', () => ({
  pty: {
    write: vi.fn((id: string, data: string) => events.push(`write:${data}`)),
    setDeliveryInterest: vi.fn((id: string, on: boolean) => events.push(`interest:${on}`)),
    onData: vi.fn((cb: (id: string, data: string) => void) => { dataCb = cb; return () => { dataCb = null } }),
  },
}))

import { typeInitialCommand } from '../bigTerminalInitialInput'

describe('typeInitialCommand (background terminals)', () => {
  beforeEach(() => { vi.useFakeTimers(); events.length = 0; dataCb = null })
  afterEach(() => vi.useRealTimers())

  it('asks for output while typing the command, even if the terminal is hidden', async () => {
    const entry = { disposed: false, ptyId: 'p1' }
    const accept = vi.fn()
    await typeInitialCommand(entry, 'p1', 'claude', undefined, accept)
    expect(events).toEqual(['interest:true', 'write:claude\n', 'interest:false'])
    expect(accept).toHaveBeenCalledWith('claude\n')
  })

  it('keeps output flowing until the launch draft is pasted into the agent', async () => {
    const entry = { disposed: false, ptyId: 'p1' }
    const done = typeInitialCommand(entry, 'p1', 'claude', 'ticket context', vi.fn())
    expect(events).toEqual(['interest:true', 'write:claude\n'])
    // The agent's input box comes up: it enables bracketed paste, then goes quiet.
    dataCb?.('p1', '\x1b[?2004h')
    await vi.advanceTimersByTimeAsync(1_600)
    await done
    expect(events).toEqual(['interest:true', 'write:claude\n', 'write:\x1b[200~ticket context\x1b[201~', 'interest:false'])
  })
})
