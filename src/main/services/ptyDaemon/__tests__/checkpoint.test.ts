import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CheckpointData } from '../types'

// Redirect CHECKPOINT_DIR to a temp directory for testing
const TEST_DIR = join(tmpdir(), `braid-checkpoint-test-${process.pid}`)

vi.mock('../protocol', async () => {
  const actual = await vi.importActual<typeof import('../protocol')>('../protocol')
  return {
    ...actual,
    CHECKPOINT_DIR: TEST_DIR,
    CHECKPOINT_INTERVAL_MS: 100,
  }
})

// Must import AFTER the mock is set up
const { flushCheckpoints, loadCheckpoints, deleteCheckpoint } = await import('../checkpoint')

// Minimal mock SessionHost
function createMockHost(checkpoints: CheckpointData[]) {
  return { getCheckpoints: () => checkpoints } as unknown as import('../sessionHost').SessionHost
}

describe('checkpoint', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch { /* */ }
  })

  it('writes checkpoint files', () => {
    const host = createMockHost([
      { sessionId: 's1', cwd: '/tmp', cols: 80, rows: 24, scrollback: 'data1', createdAt: 1000, checkpointedAt: 2000 },
    ])

    flushCheckpoints(host)

    const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.json'))
    expect(files).toEqual(['s1.json'])

    const content = JSON.parse(readFileSync(join(TEST_DIR, 's1.json'), 'utf8')) as CheckpointData
    expect(content.sessionId).toBe('s1')
    expect(content.scrollback).toBe('data1')
  })

  it('cleans up stale checkpoint files', () => {
    // Create an initial checkpoint
    const host1 = createMockHost([
      { sessionId: 's1', cwd: '/tmp', cols: 80, rows: 24, scrollback: 'data1', createdAt: 1000, checkpointedAt: 2000 },
    ])
    flushCheckpoints(host1)

    // Now s1 is gone
    const host2 = createMockHost([])
    flushCheckpoints(host2)

    const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.json'))
    expect(files).toEqual([])
  })

  it('loads checkpoints from disk', () => {
    const host = createMockHost([
      { sessionId: 's1', cwd: '/tmp', cols: 80, rows: 24, scrollback: 'hello', createdAt: 1000, checkpointedAt: 2000 },
      { sessionId: 's2', cwd: '/home', cols: 120, rows: 40, scrollback: 'world', createdAt: 3000, checkpointedAt: 4000 },
    ])
    flushCheckpoints(host)

    const loaded = loadCheckpoints()
    expect(loaded).toHaveLength(2)
    const ids = loaded.map((c) => c.sessionId).sort()
    expect(ids).toEqual(['s1', 's2'])
  })

  it('returns empty array when checkpoint dir does not exist', () => {
    rmSync(TEST_DIR, { recursive: true, force: true })
    const loaded = loadCheckpoints()
    expect(loaded).toEqual([])
  })

  it('skips corrupt checkpoint files', () => {
    mkdirSync(TEST_DIR, { recursive: true })
    const { writeFileSync } = require('fs')
    writeFileSync(join(TEST_DIR, 'good.json'), JSON.stringify({
      sessionId: 'good', cwd: '/tmp', cols: 80, rows: 24, scrollback: '', createdAt: 1, checkpointedAt: 1,
    }))
    writeFileSync(join(TEST_DIR, 'bad.json'), 'not valid json')

    const loaded = loadCheckpoints()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].sessionId).toBe('good')
  })

  it('deletes a specific checkpoint', () => {
    const host = createMockHost([
      { sessionId: 's1', cwd: '/tmp', cols: 80, rows: 24, scrollback: 'x', createdAt: 1, checkpointedAt: 1 },
    ])
    flushCheckpoints(host)
    expect(existsSync(join(TEST_DIR, 's1.json'))).toBe(true)

    deleteCheckpoint('s1')
    expect(existsSync(join(TEST_DIR, 's1.json'))).toBe(false)
  })

  it('deleteCheckpoint does not throw for missing file', () => {
    expect(() => deleteCheckpoint('nonexistent')).not.toThrow()
  })
})
