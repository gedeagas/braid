import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionHost, persistableEnv } from '../sessionHost'
import { shouldDropCheckpointOnExit } from '../checkpoint'
import type { CheckpointData } from '../types'

// Cold restore = the daemon died (reboot, crash, kill) and a new daemon
// re-created the session from its checkpoint as a fresh shell. The renderer
// must be able to tell that apart from a live reattach, exactly once.

interface MockPty {
  onData: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  process: string
  _emitExit: (exitCode: number, signal?: number) => void
}

const spawned: Array<{ pty: MockPty; env: Record<string, string> }> = []

vi.mock('node-pty', () => ({
  spawn: vi.fn((_shell: string, _args: string[], opts: { env: Record<string, string> }) => {
    const exits: Array<(info: { exitCode: number; signal?: number }) => void> = []
    const pty: MockPty = {
      onData: vi.fn(),
      onExit: vi.fn((cb) => { exits.push(cb) }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(() => { for (const cb of exits) cb({ exitCode: 0, signal: 1 }) }),
      process: 'zsh',
      _emitExit: (exitCode, signal) => { for (const cb of exits) cb({ exitCode, signal }) },
    }
    spawned.push({ pty, env: opts.env })
    return pty
  }),
}))

function checkpoint(overrides: Partial<CheckpointData> = {}): CheckpointData {
  return {
    sessionId: 'bt-1-1', cwd: '/repo', cols: 80, rows: 24, scrollback: 'old output',
    createdAt: 1, checkpointedAt: 2, ...overrides,
  }
}

describe('cold restore in the session host', () => {
  let host: SessionHost

  beforeEach(() => {
    host = new SessionHost()
    spawned.length = 0
  })

  it('flags restored sessions as cold, and live spawns as not cold', async () => {
    await host.restore(checkpoint(), '/bin/zsh')
    await host.spawn('bt-2-2', '/repo', 80, 24, '/bin/zsh')
    const byId = Object.fromEntries(host.list().map((s) => [s.sessionId, s.coldRestored]))
    expect(byId).toEqual({ 'bt-1-1': true, 'bt-2-2': false })
  })

  it('lets exactly one caller claim the cold restore', async () => {
    await host.restore(checkpoint(), '/bin/zsh')
    expect(host.isColdRestored('bt-1-1')).toBe(true)
    expect(host.consumeColdRestore('bt-1-1')).toBe(true)
    expect(host.consumeColdRestore('bt-1-1')).toBe(false)
    expect(host.isColdRestored('bt-1-1')).toBe(false)
  })

  it('never claims for a live or unknown session', async () => {
    await host.spawn('bt-2-2', '/repo', 80, 24, '/bin/zsh')
    expect(host.consumeColdRestore('bt-2-2')).toBe(false)
    expect(host.consumeColdRestore('nope')).toBe(false)
  })

  it('re-applies the persisted Braid env so hooks keep working in the restored shell', async () => {
    await host.restore(checkpoint({ env: { BRAID_TERMINAL_ID: 'bt-1-1', BRAID_TERMINAL: '1' } }), '/bin/zsh')
    expect(spawned[0].env.BRAID_TERMINAL_ID).toBe('bt-1-1')
    expect(spawned[0].env.BRAID_TERMINAL).toBe('1')
  })

  it('recovers the terminal id from the session id for checkpoints written before env was saved', async () => {
    await host.restore(checkpoint(), '/bin/zsh')
    expect(spawned[0].env.BRAID_TERMINAL_ID).toBe('bt-1-1')
    expect(spawned[0].env.BRAID_TERMINAL).toBe('1')
    expect(host.getCheckpoints()[0].env).toEqual({ BRAID_TERMINAL_ID: 'bt-1-1', BRAID_TERMINAL: '1' })
  })

  it('never invents a terminal id for a daemon-generated session id', async () => {
    await host.restore(checkpoint({ sessionId: 'pty-d-1-abc' }), '/bin/zsh')
    expect(spawned[0].env.BRAID_TERMINAL_ID).toBeUndefined()
  })

  it('ignores tampered env keys and values from a checkpoint file', async () => {
    await host.restore(checkpoint({
      env: { BRAID_TERMINAL_ID: 'bt-1-1\nrm', PATH: '/evil', LD_PRELOAD: '/x.so' } as Record<string, string>,
    }), '/bin/zsh')
    expect(spawned[0].env.BRAID_TERMINAL_ID).toBeUndefined()
    expect(spawned[0].env.PATH).not.toBe('/evil')
    expect(spawned[0].env.LD_PRELOAD).toBeUndefined()
  })

  it('checkpoints only the allowlisted env, never the hook token', async () => {
    await host.spawn('bt-2-2', '/repo', 80, 24, '/bin/zsh', {
      BRAID_TERMINAL_ID: 'bt-2-2', BRAID_TERMINAL: '1', BRAID_HOOK_TOKEN: 'secret', BRAID_HOOK_PORT: '1234', HOME: '/h',
    })
    expect(host.getCheckpoints()[0].env).toEqual({ BRAID_TERMINAL_ID: 'bt-2-2', BRAID_TERMINAL: '1' })
  })

  it('carries the env forward when a restored session is checkpointed again (two losses in a row)', async () => {
    await host.restore(checkpoint({ env: { BRAID_TERMINAL_ID: 'bt-1-1' } }), '/bin/zsh')
    expect(host.getCheckpoints()[0].env).toEqual({ BRAID_TERMINAL_ID: 'bt-1-1' })
  })

  it('reports how a session ended: by itself (clean) or by a signal', async () => {
    const exits: Array<[string, number, boolean]> = []
    host.on('exit', (id, code, clean) => { exits.push([id, code, clean]) })
    await host.spawn('a', '/repo', 80, 24, '/bin/zsh')
    await host.spawn('b', '/repo', 80, 24, '/bin/zsh')
    spawned[0].pty._emitExit(0)
    spawned[1].pty._emitExit(0, 15)
    expect(exits).toEqual([['a', 0, true], ['b', 0, false]])
  })

  it('marks only a shell that ended on its own as a self exit (its agent must not come back)', async () => {
    const selfExits: Array<[string, boolean]> = []
    host.on('exit', (id, _code, _clean, selfExit) => { selfExits.push([id, selfExit]) })
    await host.spawn('typed-exit', '/repo', 80, 24, '/bin/zsh')
    await host.spawn('signalled', '/repo', 80, 24, '/bin/zsh')
    await host.spawn('closed', '/repo', 80, 24, '/bin/zsh')
    spawned[0].pty._emitExit(0)
    spawned[1].pty._emitExit(0, 1)
    host.kill('closed')
    expect(selfExits).toEqual([['typed-exit', true], ['signalled', false], ['closed', false]])
  })

  it('treats a kill the client asked for (tab closed) as a clean end', async () => {
    const exits: boolean[] = []
    host.on('exit', (_id, _code, clean) => { exits.push(clean) })
    await host.spawn('a', '/repo', 80, 24, '/bin/zsh')
    host.kill('a')
    expect(exits).toEqual([true])
  })
})

describe('foreground at the time of loss', () => {
  let host: SessionHost

  beforeEach(() => {
    host = new SessionHost()
    spawned.length = 0
  })

  it('records whether a command (the agent) or the bare shell was in the foreground', async () => {
    await host.spawn('a', '/repo', 80, 24, '/bin/zsh')
    await host.spawn('b', '/repo', 80, 24, '/bin/zsh')
    spawned[0].pty.process = 'claude'
    spawned[1].pty.process = '-zsh'
    host.sampleForeground()
    const fg = Object.fromEntries(host.getCheckpoints().map((c) => [c.sessionId, c.foreground]))
    expect(fg).toEqual({ a: 'command', b: 'shell' })
  })

  it('is unknown until sampled, and keeps the last sample (shutdown flushes do not resample)', async () => {
    await host.spawn('a', '/repo', 80, 24, '/bin/zsh')
    expect(host.getCheckpoints()[0].foreground).toBeUndefined()
    spawned[0].pty.process = 'codex'
    host.sampleForeground()
    // During a reboot the agent can die first and hand the foreground back to
    // the shell; the next checkpoint must still say the agent was running.
    spawned[0].pty.process = 'zsh'
    expect(host.getCheckpoints()[0].foreground).toBe('command')
  })

  it('survives a cold restore and is not overwritten before the user opens the tab', async () => {
    await host.restore(checkpoint({ foreground: 'command' }), '/bin/zsh')
    // The re-created shell sits at its prompt, but nobody has claimed it yet:
    // a second loss now must still resume the agent.
    host.sampleForeground()
    expect(host.getCheckpoints()[0].foreground).toBe('command')
    expect(host.coldRestoreInfo('bt-1-1')).toEqual({ coldRestored: true, foregroundAtLoss: 'command' })
    host.consumeColdRestore('bt-1-1')
    host.sampleForeground()
    expect(host.getCheckpoints()[0].foreground).toBe('shell')
  })

  it('ignores a tampered foreground value', async () => {
    await host.restore(checkpoint({ foreground: 'rm -rf' as never }), '/bin/zsh')
    expect(host.coldRestoreInfo('bt-1-1')).toEqual({ coldRestored: true })
  })

  it('reports nothing for live sessions', async () => {
    await host.spawn('a', '/repo', 80, 24, '/bin/zsh')
    expect(host.coldRestoreInfo('a')).toEqual({ coldRestored: false })
  })
})

describe('persistableEnv', () => {
  it('keeps only safe Braid identity keys', () => {
    expect(persistableEnv({ BRAID_TERMINAL_ID: 'bt-1-1', BRAID_HOOK_TOKEN: 't', FOO: 'x' })).toEqual({ BRAID_TERMINAL_ID: 'bt-1-1' })
    expect(persistableEnv(undefined)).toEqual({})
    expect(persistableEnv({ BRAID_TERMINAL_ID: 42 } as unknown as Record<string, string>)).toEqual({})
  })
})

describe('shouldDropCheckpointOnExit', () => {
  it('drops the checkpoint when the shell ended by itself (user typed exit)', () => {
    expect(shouldDropCheckpointOnExit({ clean: true, shuttingDown: false })).toBe(true)
  })

  it('keeps it when the shell was killed by a signal (logout, reboot) so it can be restored', () => {
    expect(shouldDropCheckpointOnExit({ clean: false, shuttingDown: false })).toBe(false)
  })

  it('keeps everything while the daemon itself is shutting down', () => {
    expect(shouldDropCheckpointOnExit({ clean: true, shuttingDown: true })).toBe(false)
  })
})
