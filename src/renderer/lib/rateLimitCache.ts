/**
 * Persist and hydrate rate limit data with TTL-based expiry.
 *
 * Each entry expires based on its rate limit type:
 * - five_hour: 5 hours
 * - seven_day / seven_day_opus / seven_day_sonnet: 7 days
 * - overage: 24 hours
 * - unknown: 1 hour
 */
import { SK } from './storageKeys'
import type { RateLimitInfo } from '@/types'

interface CachedEntry {
  data: RateLimitInfo
  expiresAt: number
}

type CachedRateLimits = Record<string, CachedEntry>

const TTL_MS: Record<string, number> = {
  five_hour: 5 * 60 * 60 * 1000,        // 5 hours
  seven_day: 7 * 24 * 60 * 60 * 1000,   // 7 days
  seven_day_opus: 7 * 24 * 60 * 60 * 1000,
  seven_day_sonnet: 7 * 24 * 60 * 60 * 1000,
  overage: 24 * 60 * 60 * 1000,          // 24 hours
}

const DEFAULT_TTL_MS = 60 * 60 * 1000    // 1 hour fallback

function getTtl(rateLimitType: string): number {
  return TTL_MS[rateLimitType] ?? DEFAULT_TTL_MS
}

/**
 * Load cached rate limits from localStorage, filtering out expired entries.
 */
export function loadRateLimits(): Record<string, RateLimitInfo> | null {
  try {
    const raw = localStorage.getItem(SK.rateLimits)
    if (!raw) return null

    const cached: CachedRateLimits = JSON.parse(raw)
    const now = Date.now()
    const result: Record<string, RateLimitInfo> = {}
    const pruned: CachedRateLimits = {}
    let hasValid = false
    let hasExpired = false

    for (const [key, entry] of Object.entries(cached)) {
      if (now < entry.expiresAt) {
        result[key] = entry.data
        pruned[key] = entry
        hasValid = true
      } else {
        hasExpired = true
      }
    }

    // Persist pruned data back to storage so expired entries don't accumulate
    if (hasExpired) {
      if (hasValid) {
        localStorage.setItem(SK.rateLimits, JSON.stringify(pruned))
      } else {
        localStorage.removeItem(SK.rateLimits)
      }
    }

    return hasValid ? result : null
  } catch {
    return null
  }
}

/**
 * Save a single rate limit entry, merging with existing cached data.
 * TTL is set based on the rate limit type's window.
 */
export function saveRateLimitEntry(info: RateLimitInfo): void {
  try {
    const raw = localStorage.getItem(SK.rateLimits)
    const cached: CachedRateLimits = raw ? JSON.parse(raw) : {}
    const now = Date.now()

    // Prune expired entries while we're here
    for (const [key, entry] of Object.entries(cached)) {
      if (now >= entry.expiresAt) {
        delete cached[key]
      }
    }

    // Add/update the new entry with appropriate TTL
    cached[info.rateLimitType] = {
      data: info,
      expiresAt: now + getTtl(info.rateLimitType),
    }

    localStorage.setItem(SK.rateLimits, JSON.stringify(cached))
  } catch {
    // Quota exceeded or access denied - silently ignore
  }
}
