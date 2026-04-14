/**
 * Generic TTL cache with in-flight deduplication for main-process CLI calls.
 *
 * Usage:
 *   const cache = new ServiceCache<PrStatus | null>(30_000)
 *   const pr = await cache.get(worktreePath, () => fetchPr(worktreePath))
 *
 * - Concurrent calls with the same key share a single in-flight promise.
 * - Errors from the factory are NOT cached (next call retries).
 * - Use `invalidate(key)` after mutations to force the next read to re-fetch.
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number // Date.now() + ttl; Infinity for session-permanent
}

interface GetOptions {
  /** Bypass the cache and force a fresh fetch. */
  forceRefresh?: boolean
}

export class ServiceCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private inFlight = new Map<string, Promise<T>>()

  /**
   * @param ttl Time-to-live in milliseconds. Use `Infinity` for session-permanent entries.
   */
  constructor(private readonly ttl: number) {}

  /**
   * Return a cached value if fresh, otherwise call `fn()` and cache the result.
   * Concurrent calls with the same key share one in-flight promise.
   */
  async get(key: string, fn: () => Promise<T>, opts?: GetOptions): Promise<T> {
    // Serve from cache unless forced
    if (!opts?.forceRefresh) {
      const entry = this.cache.get(key)
      if (entry && Date.now() < entry.expiresAt) {
        return entry.value
      }
    }

    // Deduplicate concurrent requests for the same key
    const existing = this.inFlight.get(key)
    if (existing && !opts?.forceRefresh) return existing

    const promise = fn()
      .then((value) => {
        this.cache.set(key, { value, expiresAt: Date.now() + this.ttl })
        return value
      })
      .finally(() => {
        // Only remove if this is still the tracked promise (a forceRefresh may have replaced it)
        if (this.inFlight.get(key) === promise) {
          this.inFlight.delete(key)
        }
      })

    this.inFlight.set(key, promise)
    return promise
  }

  /** Remove a specific key (and any in-flight request). */
  invalidate(key: string): void {
    this.cache.delete(key)
    this.inFlight.delete(key)
  }

  /** Remove all entries whose key matches the predicate. */
  invalidateWhere(predicate: (key: string) => boolean): void {
    for (const key of [...this.cache.keys()]) {
      if (predicate(key)) {
        this.cache.delete(key)
        this.inFlight.delete(key)
      }
    }
  }

  /** Clear the entire cache. */
  clear(): void {
    this.cache.clear()
    this.inFlight.clear()
  }

  /** Number of cached entries (for testing / debugging). */
  get size(): number {
    return this.cache.size
  }
}
