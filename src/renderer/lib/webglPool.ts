// WebGL renderer pool for xterm terminals.
//
// Chromium caps live WebGL contexts per renderer (raised to 128 in main) and
// silently loses the oldest when the cap is hit. Each terminal used to keep
// its context forever. Now:
//  - a terminal acquires WebGL when shown and releases it when hidden;
//  - the 6 most recently viewed hidden terminals keep theirs (cheap switch
//    back); older ones are disposed (least recently used first);
//  - on context loss the addon is disposed and re-acquired on the next show,
//    unless that terminal lost it 3 times within 60s: then it stays on the DOM
//    renderer until the app restarts;
//  - WebGL is disposed before a terminal's DOM node is moved (reparenting can
//    corrupt the context without a contextlost event), and re-acquired after.
//  - A terminal that was never opened (background warm-up) never acquires.

import { WebglAddon } from '@xterm/addon-webgl'
import { onShowChange } from './ptyOutput/visibility'

export const MAX_HIDDEN_WEBGL = 6
const LOSS_WINDOW_MS = 60_000
const MAX_LOSSES = 3

/** What the pool needs from an xterm Terminal. */
export interface PoolTerminal {
  element?: HTMLElement
  rows: number
  refresh(start: number, end: number): void
  loadAddon?(addon: unknown): void
}

interface Disposable { dispose(): void }
type Factory = (term: PoolTerminal, onLoss: () => void) => Disposable | null

interface Slot {
  addon: Disposable | null
  shown: boolean
  losses: number[]
  disabled: boolean
}

function defaultFactory(term: PoolTerminal, onLoss: () => void): Disposable | null {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(onLoss)
    ;(term as unknown as { loadAddon(a: WebglAddon): void }).loadAddon(webgl)
    // Repaint immediately so the terminal isn't blank after attach
    try { term.refresh(0, term.rows - 1) } catch { /* ignore */ }
    return webgl
  } catch (e) {
    console.debug('[terminal] WebGL unavailable, using DOM renderer', e)
    return null
  }
}

let factory: Factory = defaultFactory
const slots = new Map<PoolTerminal, Slot>()
/** Hidden terminals holding WebGL, least recently viewed first. */
let hiddenLru: PoolTerminal[] = []

function slot(term: PoolTerminal): Slot {
  let s = slots.get(term)
  if (!s) {
    s = { addon: null, shown: false, losses: [], disabled: false }
    slots.set(term, s)
  }
  return s
}

function disposeAddon(term: PoolTerminal, s: Slot): void {
  hiddenLru = hiddenLru.filter((t) => t !== term)
  if (!s.addon) return
  const addon = s.addon
  s.addon = null
  try { addon.dispose() } catch { /* ignore */ }
}

function onContextLoss(term: PoolTerminal, s: Slot): void {
  const now = Date.now()
  s.losses = s.losses.filter((t) => now - t < LOSS_WINDOW_MS)
  s.losses.push(now)
  if (s.losses.length >= MAX_LOSSES) {
    s.disabled = true
    console.warn('[terminal] WebGL context lost repeatedly - using the DOM renderer for this terminal')
  }
  disposeAddon(term, s)
}

function create(term: PoolTerminal, s: Slot): void {
  if (s.addon || s.disabled || !term.element) return
  let addon: Disposable | null = null
  addon = factory(term, () => { if (s.addon === addon) onContextLoss(term, s) })
  s.addon = addon
}

function evict(): void {
  while (hiddenLru.length > MAX_HIDDEN_WEBGL) {
    const oldest = hiddenLru[0]
    const s = slots.get(oldest)
    if (s) disposeAddon(oldest, s)
    else hiddenLru.shift()
  }
}

export const webglPool = {
  /** The terminal is on screen. */
  acquire(term: PoolTerminal): void {
    const s = slot(term)
    s.shown = true
    hiddenLru = hiddenLru.filter((t) => t !== term)
    create(term, s)
  },

  /** The terminal left the screen; it keeps WebGL while among the recent few. */
  release(term: PoolTerminal): void {
    const s = slots.get(term)
    if (!s) return
    s.shown = false
    if (!s.addon) return
    hiddenLru = hiddenLru.filter((t) => t !== term)
    hiddenLru.push(term)
    evict()
  },

  /** Move the terminal's DOM node: WebGL is disposed first, re-acquired after if shown. */
  move(term: PoolTerminal, doMove: () => void): void {
    const s = slots.get(term)
    if (s) disposeAddon(term, s)
    doMove()
    if (s?.shown) create(term, s)
  },

  /** Dispose before the node is detached (no re-acquire). */
  detach(term: PoolTerminal): void {
    const s = slots.get(term)
    if (s) disposeAddon(term, s)
  },

  /** Re-acquire for a shown terminal that lost its addon (after a re-attach). */
  refresh(term: PoolTerminal): void {
    const s = slots.get(term)
    if (s?.shown) create(term, s)
  },

  /** The terminal is being disposed. */
  forget(term: PoolTerminal): void {
    const s = slots.get(term)
    if (s) disposeAddon(term, s)
    slots.delete(term)
  },

  hasWebgl(term: PoolTerminal): boolean {
    return slots.get(term)?.addon != null
  },

  isDisabled(term: PoolTerminal): boolean {
    return slots.get(term)?.disabled === true
  },

  resetForTests(): void {
    slots.clear()
    hiddenLru = []
    factory = defaultFactory
  },
}

export function setWebglFactoryForTests(f: Factory): void {
  factory = f
}

let boundToVisibility = false

/**
 * Acquire/release WebGL as terminals are shown and hidden (right-panel tabs and
 * big terminals report through lib/ptyOutput/visibility). Call once.
 */
export function bindWebglPoolToVisibility(): void {
  if (boundToVisibility) return
  boundToVisibility = true
  onShowChange((target, shown) => {
    const term = (target as { term?: PoolTerminal }).term
    if (!term) return
    if (shown) webglPool.acquire(term)
    else webglPool.release(term)
  })
}
