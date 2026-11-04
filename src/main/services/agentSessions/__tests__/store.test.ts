import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AgentSessionStore, MAX_RECORD_AGE_MS } from '../store'

let dir = ''
let file = ''
let now = 1_000_000

function makeStore(): AgentSessionStore {
  return new AgentSessionStore({ filePath: file, now: () => now, saveDelayMs: 5_000 })
}

function onDisk(): { version: number; records: Record<string, unknown> } {
  return JSON.parse(readFileSync(file, 'utf8'))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'braid-agent-sessions-'))
  file = join(dir, 'agent-sessions', 'last-status.json')
  now = 1_000_000
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('AgentSessionStore', () => {
  it('records the latest session reported for a terminal (latest id wins, e.g. after /clear)', () => {
    const store = makeStore()
    store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S1' } })
    now += 10
    store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S2', cwd: '/r/pkg' } })
    expect(store.get('bt-1-1')).toMatchObject({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S2', cwd: '/r/pkg' }, origin: 'live', updatedAt: 1_000_010 })
  })

  it('forgets the session when the user deliberately exits', () => {
    const store = makeStore()
    store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S1' } })
    store.applySessionUpdate({ terminalId: 'bt-1-1', session: null })
    expect(store.get('bt-1-1')).toBeNull()
  })

  it('writes throttled and atomically, with private permissions', () => {
    const store = makeStore()
    store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'codex', id: 'C1' } })
    store.applySessionUpdate({ terminalId: 'bt-2-2', session: { agent: 'claude', id: 'S1' } })
    expect(existsSync(file)).toBe(false)
    vi.advanceTimersByTime(5_000)
    expect(Object.keys(onDisk().records).sort()).toEqual(['bt-1-1', 'bt-2-2'])
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  it('stamps live records as quit and flushes synchronously on app quit', () => {
    const store = makeStore()
    store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S1' } })
    store.markQuitAndFlush()
    expect(onDisk().records['bt-1-1']).toMatchObject({ origin: 'quit' })
  })

  it('survives a restart: a new store loads what the old one wrote', () => {
    const a = makeStore()
    a.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'gemini', id: 'G1', cwd: '/r' } })
    a.flush()
    const b = makeStore()
    b.load()
    expect(b.get('bt-1-1')?.session).toEqual({ agent: 'gemini', id: 'G1', cwd: '/r' })
  })

  it('drops records older than the max age on load', () => {
    const a = makeStore()
    a.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'old' } })
    a.flush()
    now += MAX_RECORD_AGE_MS + 1
    const b = makeStore()
    b.load()
    expect(b.get('bt-1-1')).toBeNull()
  })

  it('treats the file as untrusted: bad records, ids and versions are ignored', () => {
    mkdirSync(join(dir, 'agent-sessions'), { recursive: true })
    writeFileSync(file, JSON.stringify({
      version: 1,
      records: {
        'bt-1-1': { terminalId: 'bt-1-1', session: { agent: 'claude', id: '$(rm -rf ~)' }, updatedAt: now, origin: 'live' },
        'bt-2-2': { terminalId: 'bt-2-2', session: { agent: 'aider', id: 'x' }, updatedAt: now, origin: 'live' },
        'bad id': { terminalId: 'bad id', session: { agent: 'claude', id: 'S' }, updatedAt: now, origin: 'live' },
        'bt-3-3': { terminalId: 'bt-3-3', session: { agent: 'claude', id: 'ok' }, updatedAt: now, origin: 'quit' },
      },
    }))
    const store = makeStore()
    store.load()
    expect(store.list().map((r) => r.terminalId)).toEqual(['bt-3-3'])

    writeFileSync(file, '{not json')
    const corrupt = makeStore()
    expect(() => corrupt.load()).not.toThrow()
    expect(corrupt.list()).toEqual([])

    writeFileSync(file, JSON.stringify({ version: 99, records: {} }))
    const future = makeStore()
    future.load()
    expect(future.list()).toEqual([])
  })

  it('prunes records for terminals the app no longer tracks', () => {
    const store = makeStore()
    store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S1' } })
    store.applySessionUpdate({ terminalId: 'bt-2-2', session: { agent: 'claude', id: 'S2' } })
    store.retainOnly(new Set(['bt-2-2']))
    expect(store.list().map((r) => r.terminalId)).toEqual(['bt-2-2'])
  })

  it('records the last hook state for terminals with a session', () => {
    const store = makeStore()
    store.noteState('bt-1-1', 'working')
    expect(store.get('bt-1-1')).toBeNull()
    store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S1' } })
    store.noteState('bt-1-1', 'done')
    expect(store.get('bt-1-1')?.state).toBe('done')
  })

  describe('claimResume', () => {
    it('hands out the saved session for a terminal', () => {
      const store = makeStore()
      store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S1' } })
      expect(store.claimResume('bt-1-1')).toEqual({ agent: 'claude', id: 'S1' })
      expect(store.claimResume('bt-9-9')).toBeNull()
    })

    it('resumes one provider session once, even when two tabs reference it', () => {
      const store = makeStore()
      store.applySessionUpdate({ terminalId: 'bt-1-1', session: { agent: 'claude', id: 'S1' } })
      store.applySessionUpdate({ terminalId: 'bt-2-2', session: { agent: 'claude', id: 'S1' } })
      expect(store.claimResume('bt-1-1')).not.toBeNull()
      expect(store.claimResume('bt-2-2')).toBeNull()
      // The owner itself may re-claim (e.g. its terminal is rebuilt after a reload).
      expect(store.claimResume('bt-1-1')).not.toBeNull()
    })
  })
})
