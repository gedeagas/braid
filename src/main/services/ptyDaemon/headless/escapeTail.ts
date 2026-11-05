// Tracks whether the PTY output stream currently ends inside an escape
// sequence. A screen snapshot cannot capture xterm's half-parsed state, so the
// unfinished part is kept and sent after the snapshot; the rest of the
// sequence then arrives with the live output that follows.

const ESC = '\x1b'
const BEL = '\x07'
/** Introducers of string sequences (OSC, DCS, SOS, PM, APC). */
const STRING_STARTS = [']', 'P', 'X', '^', '_']
/** Never keep more than this (a huge unterminated OSC 52, say). */
const MAX_PENDING = 64 * 1024

/** Index where an unfinished escape sequence starts at the end of `text`, or -1. */
export function unfinishedEscapeStart(text: string): number {
  // An open string sequence (e.g. OSC title) may contain ESC of its ST.
  let stringStart = -1
  for (const intro of STRING_STARTS) stringStart = Math.max(stringStart, text.lastIndexOf(ESC + intro))
  if (stringStart !== -1) {
    const body = text.slice(stringStart + 2)
    const terminated = body.includes(BEL) || body.includes(ESC + '\\') || /[\x18\x1a]/.test(body)
    if (!terminated) return stringStart
  }

  const i = text.lastIndexOf(ESC)
  if (i === -1) return -1
  if (stringStart !== -1 && i > stringStart && text.startsWith(ESC + '\\', i)) return -1
  if (i + 1 >= text.length) return i
  const c = text.charCodeAt(i + 1)
  if (c === 0x5b) {
    // CSI: parameters and intermediates (0x20-0x3f) until a final byte.
    for (let j = i + 2; j < text.length; j++) {
      const b = text.charCodeAt(j)
      if (b < 0x20 || b > 0x3f) return -1
    }
    return i
  }
  if (c >= 0x20 && c <= 0x2f) {
    // ESC with intermediates (charset designation, e.g. ESC ( B).
    for (let j = i + 2; j < text.length; j++) {
      const b = text.charCodeAt(j)
      if (b < 0x20 || b > 0x2f) return -1
    }
    return i
  }
  return -1
}

/** The unfinished escape sequence at the end of everything pushed so far. */
export class EscapeTail {
  private pending = ''

  get value(): string {
    return this.pending
  }

  push(data: string): void {
    if (!data) return
    const text = this.pending ? this.pending + data : data
    const start = unfinishedEscapeStart(text)
    this.pending = start === -1 || text.length - start > MAX_PENDING ? '' : text.slice(start)
  }

  clear(): void {
    this.pending = ''
  }
}
