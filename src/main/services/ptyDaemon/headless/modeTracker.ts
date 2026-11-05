// Terminal modes a screen snapshot needs but neither SerializeAddon nor the
// public IModes exposes: mouse encoding (SGR / SGR-pixels), kitty keyboard
// flags and cursor visibility. (Cursor, saved cursor and scroll region come
// from the buffer itself, see snapshotParts.)
//
// Every handler returns false, so xterm still handles the sequence itself;
// we only watch. Without restoring these, switching back to a hidden Claude
// Code or Codex terminal would lose its keyboard and mouse modes.

import type { Terminal } from '@xterm/headless'
import { readSavedCursor } from './snapshotParts'

type BufferType = 'normal' | 'alternate'

const MOUSE_ENCODINGS = new Set([1005, 1006, 1015, 1016])
const MAX_KITTY_STACK = 16

export interface TrackedModes {
  mouseEncoding: number | null
  kittyFlags: number[]
  cursorHidden: boolean
  savedCursor: { x: number; y: number } | null
}

function first(params: (number | number[])[], fallback: number): number {
  const p = params[0]
  const v = Array.isArray(p) ? p[0] : p
  return typeof v === 'number' && v > 0 ? v : fallback
}

function savedPosition(saved: { x: number; y: number } | null): { x: number; y: number } | null {
  return saved ? { x: saved.x, y: saved.y } : null
}

export class ModeTracker {
  private mouseEncoding: number | null = null
  private cursorHidden = false
  private kitty: Record<BufferType, number[]> = { normal: [], alternate: [] }

  constructor(private term: Terminal) {
    const p = term.parser
    const active = (): BufferType => term.buffer.active.type
    const flat = (params: (number | number[])[]): number[] => params.map((x) => (Array.isArray(x) ? x[0] : x))

    p.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      for (const v of flat(params)) {
        if (MOUSE_ENCODINGS.has(v)) this.mouseEncoding = v
        else if (v === 25) this.cursorHidden = false
      }
      return false
    })
    p.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      for (const v of flat(params)) {
        if (MOUSE_ENCODINGS.has(v) && this.mouseEncoding === v) this.mouseEncoding = null
        else if (v === 25) this.cursorHidden = true
      }
      return false
    })
    // Kitty keyboard protocol: push, pop, set.
    p.registerCsiHandler({ prefix: '>', final: 'u' }, (params) => {
      const stack = this.kitty[active()]
      stack.push(flat(params)[0] ?? 0)
      if (stack.length > MAX_KITTY_STACK) stack.shift()
      return false
    })
    p.registerCsiHandler({ prefix: '<', final: 'u' }, (params) => {
      const stack = this.kitty[active()]
      stack.splice(Math.max(0, stack.length - first(params, 1)))
      return false
    })
    p.registerCsiHandler({ prefix: '=', final: 'u' }, (params) => {
      const [flags = 0, mode = 1] = flat(params)
      const stack = this.kitty[active()]
      const top = stack.length > 0 ? stack[stack.length - 1] : 0
      const next = mode === 2 ? top | flags : mode === 3 ? top & ~flags : flags
      if (stack.length === 0) stack.push(next)
      else stack[stack.length - 1] = next
      return false
    })
    // Full reset (RIS) clears everything we track.
    p.registerEscHandler({ final: 'c' }, () => { this.reset(); return false })
  }

  reset(): void {
    this.mouseEncoding = null
    this.cursorHidden = false
    this.kitty = { normal: [], alternate: [] }
  }

  state(): TrackedModes {
    const type = this.term.buffer.active.type
    return {
      mouseEncoding: this.mouseEncoding,
      kittyFlags: [...this.kitty[type]],
      cursorHidden: this.cursorHidden,
      savedCursor: savedPosition(readSavedCursor(this.term)),
    }
  }

  /**
   * Sequences that re-apply the current modes to a terminal that was just
   * given the serialized screen content (after term.reset()). The cursor is
   * restored after these (snapshotParts.cursorRestoreSequence).
   */
  restoreSequence(): string {
    const term = this.term
    const buf = term.buffer.active
    const m = term.modes
    let s = ''
    // DECCKM is one global mode, not per screen: a TUI on the alternate screen
    // (vim, less) needs it back or its arrow keys send the wrong codes.
    if (m.applicationCursorKeysMode) s += '\x1b[?1h'
    if (m.applicationKeypadMode) s += '\x1b[?66h'
    if (m.bracketedPasteMode) s += '\x1b[?2004h'
    if (m.insertMode) s += '\x1b[4h'
    if (m.reverseWraparoundMode) s += '\x1b[?45h'
    if (m.sendFocusMode) s += '\x1b[?1004h'
    if (!m.wraparoundMode) s += '\x1b[?7l'
    switch (m.mouseTrackingMode) {
      case 'x10': s += '\x1b[?9h'; break
      case 'vt200': s += '\x1b[?1000h'; break
      case 'drag': s += '\x1b[?1002h'; break
      case 'any': s += '\x1b[?1003h'; break
    }
    if (this.mouseEncoding !== null) s += `\x1b[?${this.mouseEncoding}h`
    for (const flags of this.kitty[buf.type]) s += `\x1b[>${flags}u`
    if (this.cursorHidden) s += '\x1b[?25l'
    return s
  }
}
