// Dev-only terminal performance probe. Off by default; enable with
//   localStorage.setItem('braid.perfProbe', '1')   (then reload)
// and drive it from DevTools:
//   __braidPerf.start()  ...type into a terminal...  __braidPerf.report()
//
// Typing latency: keydown -> the echo has been parsed by the focused xterm ->
// the next animation frame (when it is drawn). Dropped frames: animation
// frames that came late at 60Hz. It hooks Terminal.prototype.write and imports
// nothing else from Braid, so the same file can be dropped into an older build
// for before/after numbers.

import { Terminal } from '@xterm/xterm'

const FRAME_MS = 1000 / 60
const STORAGE_KEY = 'braid.perfProbe'

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

/** Frames missed between two animation frames `deltaMs` apart. */
export function droppedFramesFor(deltaMs: number): number {
  if (deltaMs <= FRAME_MS * 1.5) return 0
  return Math.round(deltaMs / FRAME_MS) - 1
}

export function summarize(latencies: readonly number[], dropped: number, frames: number) {
  return {
    typing: { samples: latencies.length, medianMs: percentile(latencies, 50), p95Ms: percentile(latencies, 95) },
    droppedFrames: dropped,
    frames,
  }
}

interface ProbeState {
  running: boolean
  pendingKeyAt: number | null
  latencies: number[]
  dropped: number
  frames: number
  lastFrame: number
}

function isEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

/** Install once at startup; does nothing unless enabled. */
export function installPerfProbe(): void {
  if (!isEnabled() || (window as unknown as { __braidPerf?: unknown }).__braidPerf) return
  const st: ProbeState = { running: false, pendingKeyAt: null, latencies: [], dropped: 0, frames: 0, lastFrame: 0 }

  window.addEventListener('keydown', (e) => {
    if (!st.running || e.key.length !== 1 || e.metaKey || e.ctrlKey) return
    st.pendingKeyAt = performance.now()
  }, true)

  const proto = Terminal.prototype as unknown as { write(data: string | Uint8Array, cb?: () => void): void; element?: HTMLElement }
  const original = proto.write
  proto.write = function (this: { element?: HTMLElement }, data: string | Uint8Array, cb?: () => void) {
    const keyAt = st.pendingKeyAt
    const focused = keyAt !== null && !!this.element?.contains(document.activeElement)
    if (!focused) return original.call(this, data, cb)
    st.pendingKeyAt = null
    return original.call(this, data, () => {
      requestAnimationFrame(() => st.latencies.push(performance.now() - (keyAt as number)))
      cb?.()
    })
  }

  const loop = (t: number) => {
    if (!st.running) return
    if (st.lastFrame) st.dropped += droppedFramesFor(t - st.lastFrame)
    st.lastFrame = t
    st.frames++
    requestAnimationFrame(loop)
  }

  const api = {
    start() {
      Object.assign(st, { running: true, pendingKeyAt: null, latencies: [], dropped: 0, frames: 0, lastFrame: 0 })
      requestAnimationFrame(loop)
    },
    stop() { st.running = false },
    report() {
      const paint = performance.getEntriesByName('first-contentful-paint')[0]
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      const result = {
        ...summarize(st.latencies, st.dropped, st.frames),
        firstContentfulPaintMs: paint ? Math.round(paint.startTime) : null,
        jsHeapMB: memory ? Math.round(memory.usedJSHeapSize / 1e6) : null,
      }
      console.table(result.typing)
      return result
    },
  }
  ;(window as unknown as { __braidPerf: typeof api }).__braidPerf = api
  console.info('[perfProbe] installed: __braidPerf.start() / .report()')
}
