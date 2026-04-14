import { vi } from 'vitest'

// jsdom does not implement requestAnimationFrame. Stub it so the rAF loop in
// useChatScroll can be instantiated. Tests that need to tick the loop manually
// invoke the captured callback via the rafCallbacks helper below.
const rafCallbacks = new Map<number, FrameRequestCallback>()
let rafCounter = 0

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
  const id = ++rafCounter
  rafCallbacks.set(id, cb)
  return id
})

vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
  rafCallbacks.delete(id)
})

// Expose helpers so tests can tick individual frames or drain all pending frames.
;(globalThis as Record<string, unknown>).__rafCallbacks = rafCallbacks
;(globalThis as Record<string, unknown>).__flushRaf = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const entries = [...rafCallbacks.entries()]
    rafCallbacks.clear()
    for (const [, cb] of entries) cb(performance.now())
  }
}
