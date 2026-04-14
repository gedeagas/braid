import { describe, it, expect } from 'vitest'
import {
  assignSessionColumn,
  assignPrColumn,
  computeTopStatus,
  DONE_EXPIRY_MS,
  SESSION_COLUMNS,
  PR_COLUMNS,
} from '../kanbanColumns'

const NOW = 1_000_000_000_000 // fixed reference timestamp

describe('SESSION_COLUMNS / PR_COLUMNS', () => {
  it('SESSION_COLUMNS has exactly 4 entries in priority order', () => {
    expect(SESSION_COLUMNS.map((c) => c.id)).toEqual(['idle', 'running', 'need_attention', 'done'])
  })

  it('PR_COLUMNS has exactly 3 entries', () => {
    expect(PR_COLUMNS.map((c) => c.id)).toEqual(['pr_open', 'pr_draft', 'pr_merged_closed'])
  })
})

describe('assignSessionColumn', () => {
  // ── running ───────────────────────────────────────────────────────────────

  it('returns running for status=running', () => {
    expect(assignSessionColumn('running', null, null, NOW)).toBe('running')
  })

  it('running status beats dismissedAt (running check precedes dismissed check)', () => {
    // Even when dismissed, a session that is actively running stays in "running"
    expect(assignSessionColumn('running', null, NOW - 60_000, NOW)).toBe('running')
  })

  // ── need_attention ────────────────────────────────────────────────────────

  it('returns need_attention for waiting_input when not dismissed', () => {
    expect(assignSessionColumn('waiting_input', null, null, NOW)).toBe('need_attention')
  })

  it('returns need_attention for error when not dismissed', () => {
    expect(assignSessionColumn('error', null, null, NOW)).toBe('need_attention')
  })

  // ── done (dismissed waiting_input / error) ────────────────────────────────

  it('returns done for waiting_input when dismissed', () => {
    expect(assignSessionColumn('waiting_input', null, NOW - 1000, NOW)).toBe('done')
  })

  it('returns done for error when dismissed', () => {
    expect(assignSessionColumn('error', null, NOW - 1000, NOW)).toBe('done')
  })

  // ── dismissed error/waiting_input: doneLastClearedAt eviction ─────────────

  it('clears dismissed error when dismissedAt <= doneLastClearedAt', () => {
    const dismissedAt = NOW - 60_000
    const clearedAt = NOW - 30_000
    expect(assignSessionColumn('error', null, dismissedAt, NOW, clearedAt)).toBe('idle')
  })

  it('clears dismissed error when dismissedAt === doneLastClearedAt (exact boundary)', () => {
    const dismissedAt = NOW - 60_000
    expect(assignSessionColumn('error', null, dismissedAt, NOW, dismissedAt)).toBe('idle')
  })

  it('keeps dismissed error in done when dismissedAt > doneLastClearedAt', () => {
    const clearedAt = NOW - 120_000
    const dismissedAt = clearedAt + 1
    expect(assignSessionColumn('error', null, dismissedAt, NOW, clearedAt)).toBe('done')
  })

  it('clears dismissed waiting_input when dismissedAt <= doneLastClearedAt', () => {
    const dismissedAt = NOW - 60_000
    const clearedAt = NOW - 30_000
    expect(assignSessionColumn('waiting_input', null, dismissedAt, NOW, clearedAt)).toBe('idle')
  })

  // ── dismissed error/waiting_input: auto-expiry ────────────────────────────

  it('auto-expires dismissed error session after DONE_EXPIRY_MS', () => {
    const dismissedAt = NOW - DONE_EXPIRY_MS
    expect(assignSessionColumn('error', null, dismissedAt, NOW)).toBe('idle')
  })

  it('keeps dismissed error session in done 1ms before expiry', () => {
    const dismissedAt = NOW - DONE_EXPIRY_MS + 1
    expect(assignSessionColumn('error', null, dismissedAt, NOW)).toBe('done')
  })

  it('auto-expires dismissed waiting_input session after DONE_EXPIRY_MS', () => {
    const dismissedAt = NOW - DONE_EXPIRY_MS
    expect(assignSessionColumn('waiting_input', null, dismissedAt, NOW)).toBe('idle')
  })

  it('auto-expires dismissed error session well past DONE_EXPIRY_MS', () => {
    const dismissedAt = NOW - DONE_EXPIRY_MS * 2
    expect(assignSessionColumn('error', null, dismissedAt, NOW)).toBe('idle')
  })

  // ── done window boundaries (idle sessions) ───────────────────────────────

  it('returns done for idle session 1ms before expiry', () => {
    const completedAt = NOW - DONE_EXPIRY_MS + 1
    expect(assignSessionColumn('idle', completedAt, null, NOW)).toBe('done')
  })

  it('returns idle when elapsed equals DONE_EXPIRY_MS exactly (boundary is exclusive)', () => {
    const completedAt = NOW - DONE_EXPIRY_MS
    expect(assignSessionColumn('idle', completedAt, null, NOW)).toBe('idle')
  })

  it('returns idle when elapsed is well past DONE_EXPIRY_MS', () => {
    const completedAt = NOW - DONE_EXPIRY_MS * 2
    expect(assignSessionColumn('idle', completedAt, null, NOW)).toBe('idle')
  })

  // ── doneLastClearedAt eviction (idle sessions) ───────────────────────────

  it('returns idle when completedAt < doneLastClearedAt (cleared after completion)', () => {
    const completedAt = NOW - 60_000
    const clearedAt   = NOW - 30_000
    expect(assignSessionColumn('idle', completedAt, null, NOW, clearedAt)).toBe('idle')
  })

  it('returns idle when completedAt === doneLastClearedAt (exact boundary is evicted)', () => {
    const completedAt = NOW - 60_000
    expect(assignSessionColumn('idle', completedAt, null, NOW, completedAt)).toBe('idle')
  })

  it('stays in done when completedAt is 1ms after doneLastClearedAt', () => {
    const clearedAt   = NOW - 120_000
    const completedAt = clearedAt + 1   // 1ms after the clear
    expect(assignSessionColumn('idle', completedAt, null, NOW, clearedAt)).toBe('done')
  })

  it('stays in done when completedAt > doneLastClearedAt by a large margin', () => {
    const clearedAt   = NOW - 120_000
    const completedAt = NOW - 60_000
    expect(assignSessionColumn('idle', completedAt, null, NOW, clearedAt)).toBe('done')
  })

  it('treats doneLastClearedAt=0 (epoch, not null) as a valid timestamp — modern completedAt stays done', () => {
    // completedAt is a modern timestamp >> 0, so runCompletedAt <= 0 is false → stays done
    const completedAt = NOW - 60_000
    expect(assignSessionColumn('idle', completedAt, null, NOW, 0)).toBe('done')
  })

  // ── bare idle (never ran) ─────────────────────────────────────────────────

  it('returns idle for idle session with no completedAt', () => {
    expect(assignSessionColumn('idle', null, null, NOW)).toBe('idle')
  })

  it('returns idle for inactive status', () => {
    expect(assignSessionColumn('inactive', null, null, NOW)).toBe('idle')
  })
})

describe('assignPrColumn', () => {
  it('returns pr_merged_closed for MERGED non-draft', () => {
    expect(assignPrColumn('MERGED', false)).toBe('pr_merged_closed')
  })

  it('returns pr_merged_closed for MERGED draft (state check precedes draft check)', () => {
    expect(assignPrColumn('MERGED', true)).toBe('pr_merged_closed')
  })

  it('returns pr_merged_closed for CLOSED non-draft', () => {
    expect(assignPrColumn('CLOSED', false)).toBe('pr_merged_closed')
  })

  it('returns pr_merged_closed for CLOSED draft (state check precedes draft check)', () => {
    expect(assignPrColumn('CLOSED', true)).toBe('pr_merged_closed')
  })

  it('returns pr_draft for OPEN draft', () => {
    expect(assignPrColumn('OPEN', true)).toBe('pr_draft')
  })

  it('returns pr_open for OPEN non-draft', () => {
    expect(assignPrColumn('OPEN', false)).toBe('pr_open')
  })

  it('returns pr_open for unrecognised prState when not draft (falls through to default)', () => {
    expect(assignPrColumn('UNKNOWN', false)).toBe('pr_open')
  })

  it('returns pr_draft for unrecognised prState when draft', () => {
    expect(assignPrColumn('UNKNOWN', true)).toBe('pr_draft')
  })
})

describe('computeTopStatus', () => {
  // ── empty ─────────────────────────────────────────────────────────────────

  it('returns inactive for empty list', () => {
    expect(computeTopStatus([])).toBe('inactive')
  })

  // ── homogeneous lists (each status in isolation) ──────────────────────────

  it.each([
    ['running',       'running'],
    ['waiting_input', 'waiting_input'],
    ['error',         'error'],
    ['idle',          'idle'],
    ['inactive',      'inactive'],
  ] as const)('a list of only %s entries returns %s', (status, expected) => {
    expect(computeTopStatus([status, status, status])).toBe(expected)
  })

  // ── priority ordering: every level beats all lower ones ───────────────────

  it('running beats waiting_input, error, idle, inactive', () => {
    expect(computeTopStatus(['inactive', 'idle', 'error', 'waiting_input', 'running'])).toBe('running')
  })

  it('running beats waiting_input alone', () => {
    expect(computeTopStatus(['waiting_input', 'running'])).toBe('running')
  })

  it('waiting_input beats error, idle, inactive', () => {
    expect(computeTopStatus(['inactive', 'idle', 'error', 'waiting_input'])).toBe('waiting_input')
  })

  it('waiting_input beats error alone', () => {
    expect(computeTopStatus(['error', 'waiting_input'])).toBe('waiting_input')
  })

  it('error beats idle and inactive', () => {
    expect(computeTopStatus(['inactive', 'idle', 'error'])).toBe('error')
  })

  it('error beats idle alone', () => {
    expect(computeTopStatus(['idle', 'error'])).toBe('error')
  })

  it('idle beats inactive', () => {
    expect(computeTopStatus(['inactive', 'idle'])).toBe('idle')
  })

  // ── single-element lists ──────────────────────────────────────────────────

  it.each([
    'running', 'waiting_input', 'error', 'idle', 'inactive',
  ] as const)('returns the single status %s unchanged', (status) => {
    expect(computeTopStatus([status])).toBe(status)
  })
})
