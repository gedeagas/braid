// Decides where to cut queued PTY output into slices for the renderer.
//
// Two rules on top of the size limit:
//  - never split a UTF-16 surrogate pair (xterm would render two U+FFFD), and
//  - keep a DEC 2026 synchronized-output frame in one slice, so the renderer
//    never paints half a TUI redraw, unless the frame is already oversized.

export const SYNC_BEGIN = '\x1b[?2026h'
export const SYNC_END = '\x1b[?2026l'

export interface SliceLimits {
  /** Normal slice size. */
  maxChars: number
  /** A synchronized frame up to this size is kept whole. */
  maxSyncFrame: number
}

export interface SliceOptions {
  /** The text starts inside an oversized frame that an earlier slice split. */
  headInFrame?: boolean
  /** An unfinished frame has been held long enough: cut it anyway. */
  force?: boolean
}

export interface Slice {
  /** Characters to send now. 0 = hold (an unfinished small frame is at the head). */
  length: number
  /** The remainder starts inside a frame this slice had to split. */
  splitFrame: boolean
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** Cut at `cut`, moved back one unit if it would split a surrogate pair. */
function safeCut(text: string, cut: number): number {
  if (cut > 0 && cut < text.length && isHighSurrogate(text.charCodeAt(cut - 1))) return cut - 1
  return cut
}

/**
 * Where the open frame enclosing `cut` starts, or -1 when `cut` is outside
 * any frame. `from` skips a head region that belongs to an already split frame.
 */
function openFrameStart(text: string, cut: number, from: number): number {
  const begin = text.lastIndexOf(SYNC_BEGIN, cut - SYNC_BEGIN.length)
  if (begin < from) return -1
  const end = text.lastIndexOf(SYNC_END, cut - SYNC_END.length)
  return begin > end ? begin : -1
}

/**
 * Length of the next slice of `text`. `text` may be a window of a longer
 * queue: it must hold at least `maxChars + maxSyncFrame + SYNC_END.length`
 * characters when the queue has that many, so frame sizes can be judged.
 */
export function nextSlice(text: string, limits: SliceLimits, opts: SliceOptions = {}): Slice {
  if (text.length === 0) return { length: 0, splitFrame: false }
  const plainCut = safeCut(text, Math.min(text.length, limits.maxChars))

  // Head of a frame an earlier slice split: plain output up to its end.
  let from = 0
  if (opts.headInFrame) {
    const end = text.indexOf(SYNC_END)
    if (end === -1 || end + SYNC_END.length > plainCut) return { length: plainCut, splitFrame: true }
    from = end + SYNC_END.length
  }

  if (opts.force) return { length: plainCut, splitFrame: openFrameStart(text, plainCut, from) !== -1 }

  const frameStart = openFrameStart(text, plainCut, from)
  if (frameStart === -1) return { length: plainCut, splitFrame: false }

  const endIdx = text.indexOf(SYNC_END, frameStart + SYNC_BEGIN.length)
  const frameSize = endIdx === -1 ? text.length - frameStart : endIdx + SYNC_END.length - frameStart
  if (frameSize > limits.maxSyncFrame) return { length: plainCut, splitFrame: true }
  // Send what comes before the frame; the frame goes out whole next time.
  if (frameStart > 0) return { length: frameStart, splitFrame: false }
  if (endIdx === -1) return { length: 0, splitFrame: false }
  return { length: endIdx + SYNC_END.length, splitFrame: false }
}
