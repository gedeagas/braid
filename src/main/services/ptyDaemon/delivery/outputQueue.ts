// Per-terminal queue of PTY output waiting to be sent to the renderer.
//
// Kept as a list of chunks (not one growing string) so a backed-up queue of
// megabytes is never re-flattened on every flush: peek/take only touch the
// head. Each chunk remembers the daemon's output sequence number, so output
// already covered by a screen snapshot can be dropped exactly.

interface Chunk {
  data: string
  seq: number
}

export class OutputQueue {
  private chunks: Chunk[] = []
  /** Characters of chunks[0] already taken. */
  private head = 0
  private size = 0
  /** The head is inside a synchronized frame an earlier slice had to split. */
  headInFrame = false
  /** When an unfinished frame at the head started being held. */
  holdSince: number | null = null

  get length(): number {
    return this.size
  }

  push(data: string, seq = 0): void {
    if (!data) return
    this.chunks.push({ data, seq })
    this.size += data.length
  }

  /** Up to `max` characters from the head, without removing them. */
  peek(max: number): string {
    if (this.chunks.length === 0 || max <= 0) return ''
    const first = this.chunks[0].data
    if (first.length - this.head >= max) return first.slice(this.head, this.head + max)
    const parts = [first.slice(this.head)]
    let len = parts[0].length
    for (let i = 1; i < this.chunks.length && len < max; i++) {
      const d = this.chunks[i].data
      const part = d.length > max - len ? d.slice(0, max - len) : d
      parts.push(part)
      len += part.length
    }
    return parts.join('')
  }

  /** Remove and return `n` characters from the head. */
  take(n: number): string {
    const out = this.peek(n)
    let left = out.length
    while (left > 0 && this.chunks.length > 0) {
      const avail = this.chunks[0].data.length - this.head
      if (avail <= left) {
        left -= avail
        this.chunks.shift()
        this.head = 0
      } else {
        this.head += left
        left = 0
      }
    }
    this.size -= out.length
    return out
  }

  /** Drop every chunk with a sequence number <= `seq`. Returns characters dropped. */
  dropThrough(seq: number): number {
    let dropped = 0
    while (this.chunks.length > 0 && this.chunks[0].seq <= seq) {
      dropped += this.chunks[0].data.length - this.head
      this.chunks.shift()
      this.head = 0
    }
    this.size -= dropped
    if (dropped > 0) {
      this.headInFrame = false
      this.holdSince = null
    }
    return dropped
  }

  clear(): void {
    this.chunks = []
    this.head = 0
    this.size = 0
    this.headInFrame = false
    this.holdSince = null
  }
}
