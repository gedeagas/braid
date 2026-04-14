import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceCache } from '../serviceCache'

describe('ServiceCache', () => {
  let cache: ServiceCache<string>

  beforeEach(() => {
    cache = new ServiceCache<string>(1000) // 1s TTL
  })

  it('calls factory on first access', async () => {
    const fn = vi.fn().mockResolvedValue('hello')
    const result = await cache.get('k1', fn)
    expect(result).toBe('hello')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('returns cached value within TTL', async () => {
    const fn = vi.fn().mockResolvedValue('hello')
    await cache.get('k1', fn)
    const result = await cache.get('k1', fn)
    expect(result).toBe('hello')
    expect(fn).toHaveBeenCalledOnce() // factory NOT called again
  })

  it('re-fetches after TTL expires', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')

    const r1 = await cache.get('k1', fn)
    expect(r1).toBe('v1')

    vi.advanceTimersByTime(1001)

    const r2 = await cache.get('k1', fn)
    expect(r2).toBe('v2')
    expect(fn).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('deduplicates concurrent in-flight requests', async () => {
    let resolveFactory!: (v: string) => void
    const fn = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveFactory = resolve })
    )

    const p1 = cache.get('k1', fn)
    const p2 = cache.get('k1', fn)

    resolveFactory('shared')

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe('shared')
    expect(r2).toBe('shared')
    expect(fn).toHaveBeenCalledOnce() // only one factory call
  })

  it('forceRefresh bypasses cache', async () => {
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')

    await cache.get('k1', fn)
    const r2 = await cache.get('k1', fn, { forceRefresh: true })

    expect(r2).toBe('v2')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('forceRefresh bypasses in-flight dedup', async () => {
    let resolveFirst!: (v: string) => void
    const fn = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveFirst = r }))
      .mockResolvedValueOnce('forced')

    const p1 = cache.get('k1', fn)
    const p2 = cache.get('k1', fn, { forceRefresh: true })

    resolveFirst('original')
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toBe('original')
    expect(r2).toBe('forced')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not cache errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('recovered')

    await expect(cache.get('k1', fn)).rejects.toThrow('fail')

    const result = await cache.get('k1', fn)
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('invalidate removes entry and allows re-fetch', async () => {
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')

    await cache.get('k1', fn)
    cache.invalidate('k1')

    const result = await cache.get('k1', fn)
    expect(result).toBe('v2')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('invalidateWhere removes matching entries', async () => {
    const fn = vi.fn().mockResolvedValue('val')

    await cache.get('/repo/a', fn)
    await cache.get('/repo/b', fn)
    await cache.get('/other/c', fn)
    expect(cache.size).toBe(3)

    cache.invalidateWhere((k) => k.startsWith('/repo'))
    expect(cache.size).toBe(1)
  })

  it('clear removes all entries', async () => {
    const fn = vi.fn().mockResolvedValue('val')

    await cache.get('a', fn)
    await cache.get('b', fn)
    expect(cache.size).toBe(2)

    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('Infinity TTL never expires', async () => {
    vi.useFakeTimers()
    const permanent = new ServiceCache<string>(Infinity)
    const fn = vi.fn().mockResolvedValue('permanent')

    await permanent.get('k', fn)
    vi.advanceTimersByTime(999_999_999)

    await permanent.get('k', fn)
    expect(fn).toHaveBeenCalledOnce()

    vi.useRealTimers()
  })
})
