import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadRateLimits, saveRateLimitEntry } from '../rateLimitCache'
import type { RateLimitInfo } from '@/types'

// Mock localStorage
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

function makeEntry(overrides: Partial<RateLimitInfo> = {}): RateLimitInfo {
  return {
    rateLimitType: 'five_hour',
    utilization: 0.42,
    status: 'allowed',
    updatedAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  vi.clearAllMocks()
})

describe('loadRateLimits', () => {
  it('returns null when nothing is cached', () => {
    expect(loadRateLimits()).toBeNull()
  })

  it('returns valid entries and filters out expired ones', () => {
    const now = Date.now()
    const cached = {
      five_hour: { data: makeEntry(), expiresAt: now + 10_000 },
      seven_day: { data: makeEntry({ rateLimitType: 'seven_day' }), expiresAt: now - 1 },
    }
    store['braid:rateLimits'] = JSON.stringify(cached)

    const result = loadRateLimits()
    expect(result).not.toBeNull()
    expect(result!['five_hour']).toBeDefined()
    expect(result!['seven_day']).toBeUndefined()
  })

  it('persists pruned data back to localStorage when some entries expired', () => {
    const now = Date.now()
    const cached = {
      five_hour: { data: makeEntry(), expiresAt: now + 10_000 },
      seven_day: { data: makeEntry({ rateLimitType: 'seven_day' }), expiresAt: now - 1 },
    }
    store['braid:rateLimits'] = JSON.stringify(cached)

    loadRateLimits()

    // Should have written back only the valid entry
    const persisted = JSON.parse(store['braid:rateLimits'])
    expect(Object.keys(persisted)).toEqual(['five_hour'])
  })

  it('removes localStorage key when all entries are expired', () => {
    const now = Date.now()
    const cached = {
      five_hour: { data: makeEntry(), expiresAt: now - 1 },
      seven_day: { data: makeEntry({ rateLimitType: 'seven_day' }), expiresAt: now - 1 },
    }
    store['braid:rateLimits'] = JSON.stringify(cached)

    const result = loadRateLimits()
    expect(result).toBeNull()
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('braid:rateLimits')
  })

  it('returns null for corrupted JSON', () => {
    store['braid:rateLimits'] = '{not valid json'
    expect(loadRateLimits()).toBeNull()
  })
})

describe('saveRateLimitEntry', () => {
  it('saves an entry with appropriate TTL', () => {
    const entry = makeEntry({ rateLimitType: 'five_hour' })
    saveRateLimitEntry(entry)

    const stored = JSON.parse(store['braid:rateLimits'])
    expect(stored['five_hour']).toBeDefined()
    expect(stored['five_hour'].data).toEqual(entry)
    // 5-hour TTL
    const expectedExpiry = entry.updatedAt + 5 * 60 * 60 * 1000
    expect(stored['five_hour'].expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100)
    expect(stored['five_hour'].expiresAt).toBeLessThanOrEqual(expectedExpiry + 100)
  })

  it('merges with existing entries', () => {
    const now = Date.now()
    const existing = {
      five_hour: { data: makeEntry(), expiresAt: now + 10_000 },
    }
    store['braid:rateLimits'] = JSON.stringify(existing)

    saveRateLimitEntry(makeEntry({ rateLimitType: 'seven_day', utilization: 0.1 }))

    const stored = JSON.parse(store['braid:rateLimits'])
    expect(stored['five_hour']).toBeDefined()
    expect(stored['seven_day']).toBeDefined()
  })

  it('prunes expired entries on save', () => {
    const now = Date.now()
    const existing = {
      five_hour: { data: makeEntry(), expiresAt: now - 1 },
    }
    store['braid:rateLimits'] = JSON.stringify(existing)

    saveRateLimitEntry(makeEntry({ rateLimitType: 'seven_day' }))

    const stored = JSON.parse(store['braid:rateLimits'])
    expect(stored['five_hour']).toBeUndefined()
    expect(stored['seven_day']).toBeDefined()
  })

  it('handles corrupted existing data gracefully', () => {
    store['braid:rateLimits'] = 'garbage'
    // Should not throw - silently caught
    expect(() => saveRateLimitEntry(makeEntry())).not.toThrow()
  })

  it('uses default TTL for unknown rate limit types', () => {
    const entry = makeEntry({ rateLimitType: 'exotic_new_type' })
    saveRateLimitEntry(entry)

    const stored = JSON.parse(store['braid:rateLimits'])
    // Default is 1 hour
    const expectedExpiry = Date.now() + 60 * 60 * 1000
    expect(stored['exotic_new_type'].expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 200)
    expect(stored['exotic_new_type'].expiresAt).toBeLessThanOrEqual(expectedExpiry + 200)
  })
})
