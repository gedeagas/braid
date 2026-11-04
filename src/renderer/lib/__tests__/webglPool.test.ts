import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { webglPool, setWebglFactoryForTests, MAX_HIDDEN_WEBGL, type PoolTerminal } from '../webglPool'

interface FakeAddon { dispose: ReturnType<typeof vi.fn>; loseContext: () => void }

const addons: FakeAddon[] = []
const factory = vi.fn((_term: PoolTerminal, onLoss: () => void) => {
  const addon: FakeAddon = { dispose: vi.fn(), loseContext: onLoss }
  addons.push(addon)
  return addon
})

function term(opened = true): PoolTerminal {
  return { element: opened ? ({} as HTMLElement) : undefined, refresh: vi.fn(), rows: 24 }
}

describe('webglPool', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    addons.length = 0
    factory.mockClear()
    webglPool.resetForTests()
    setWebglFactoryForTests(factory as unknown as Parameters<typeof setWebglFactoryForTests>[0])
  })
  afterEach(() => vi.useRealTimers())

  it('acquires WebGL when a terminal is shown and keeps it while hidden', () => {
    const t = term()
    webglPool.acquire(t)
    expect(webglPool.hasWebgl(t)).toBe(true)
    webglPool.release(t)
    expect(webglPool.hasWebgl(t)).toBe(true)
    webglPool.acquire(t)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('keeps WebGL for the 6 most recently viewed hidden terminals', () => {
    expect(MAX_HIDDEN_WEBGL).toBe(6)
    const terms = Array.from({ length: 8 }, () => term())
    for (const t of terms) { webglPool.acquire(t); webglPool.release(t) }
    expect(terms.map((t) => webglPool.hasWebgl(t))).toEqual([false, false, true, true, true, true, true, true])
    expect(addons[0].dispose).toHaveBeenCalled()
    expect(addons[1].dispose).toHaveBeenCalled()
  })

  it('treats re-showing a hidden terminal as most recently viewed', () => {
    const terms = Array.from({ length: 6 }, () => term())
    for (const t of terms) { webglPool.acquire(t); webglPool.release(t) }
    webglPool.acquire(terms[0])
    webglPool.release(terms[0])
    const extra = term()
    webglPool.acquire(extra)
    webglPool.release(extra)
    expect(webglPool.hasWebgl(terms[0])).toBe(true)
    expect(webglPool.hasWebgl(terms[1])).toBe(false)
  })

  it('never evicts a terminal that is on screen', () => {
    const visible = Array.from({ length: 10 }, () => term())
    for (const t of visible) webglPool.acquire(t)
    expect(visible.every((t) => webglPool.hasWebgl(t))).toBe(true)
  })

  it('re-acquires after a context loss on the next show', () => {
    const t = term()
    webglPool.acquire(t)
    addons[0].loseContext()
    expect(addons[0].dispose).toHaveBeenCalled()
    expect(webglPool.hasWebgl(t)).toBe(false)
    webglPool.release(t)
    webglPool.acquire(t)
    expect(webglPool.hasWebgl(t)).toBe(true)
  })

  it('stays on the DOM renderer after 3 losses within 60s', () => {
    const t = term()
    for (let i = 0; i < 3; i++) {
      webglPool.acquire(t)
      addons[addons.length - 1].loseContext()
      webglPool.release(t)
      vi.advanceTimersByTime(10_000)
    }
    webglPool.acquire(t)
    expect(webglPool.hasWebgl(t)).toBe(false)
    expect(webglPool.isDisabled(t)).toBe(true)
    vi.advanceTimersByTime(120_000)
    webglPool.acquire(t)
    expect(webglPool.hasWebgl(t)).toBe(false)
  })

  it('forgives losses older than 60s', () => {
    const t = term()
    for (let i = 0; i < 3; i++) {
      webglPool.acquire(t)
      addons[addons.length - 1].loseContext()
      webglPool.release(t)
      vi.advanceTimersByTime(31_000)
    }
    webglPool.acquire(t)
    expect(webglPool.hasWebgl(t)).toBe(true)
  })

  it('disposes before a DOM move and re-acquires afterwards if shown', () => {
    const t = term()
    webglPool.acquire(t)
    const move = vi.fn(() => { expect(addons[0].dispose).toHaveBeenCalled() })
    webglPool.move(t, move)
    expect(move).toHaveBeenCalled()
    expect(webglPool.hasWebgl(t)).toBe(true)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('does not acquire for a hidden terminal moved in the DOM', () => {
    const t = term()
    webglPool.move(t, () => {})
    expect(factory).not.toHaveBeenCalled()
  })

  it('never acquires for a terminal that was never opened (background warm-up)', () => {
    const t = term(false)
    webglPool.acquire(t)
    expect(factory).not.toHaveBeenCalled()
  })

  it('releases everything for a disposed terminal', () => {
    const t = term()
    webglPool.acquire(t)
    webglPool.forget(t)
    expect(addons[0].dispose).toHaveBeenCalled()
    expect(webglPool.hasWebgl(t)).toBe(false)
  })
})
