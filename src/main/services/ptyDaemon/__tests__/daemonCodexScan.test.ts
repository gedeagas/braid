import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HeadlessSession } from '../headless/headlessSession'

// The daemon's fallback Codex prompt scan (request_user_input pane text).

const PROMPT = 'Question 1/2\r\nPick one\r\n  option 1/3 unanswered\r\nSubmit with Enter'

describe('daemon Codex prompt scan', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const session = () => {
    const events: Array<{ kind: string; replayed: boolean }> = []
    const s = new HeadlessSession({ cols: 60, rows: 10, scrollback: 50 }, {
      expectedAgentType: () => 'codex',
      status: (e) => events.push({ kind: e.kind, replayed: e.replayed }),
    })
    return { s, events }
  }
  const settle = async () => { for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(100) }

  it('announces a prompt that live output drew', async () => {
    const { s, events } = session()
    s.write(PROMPT, { live: true, seq: 1 })
    await settle()
    expect(events).toEqual([{ kind: 'scan', replayed: false }])
    s.dispose()
  })

  it('does not announce a prompt left on screen by a restored checkpoint', async () => {
    const { s, events } = session()
    s.write(PROMPT, { live: false })
    await settle()
    expect(events).toEqual([])
    s.dispose()
  })
})
