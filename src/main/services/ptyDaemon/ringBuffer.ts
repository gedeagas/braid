/**
 * Bounded buffer holding the last N characters of a terminal's output, for
 * snapshot/reattach and scrollback persistence. Shared by the daemon, its
 * main-process adapter, and the in-process PtyService.
 */
import { BUFFER_MAX_LENGTH } from './protocol'

export class RingBuffer {
  private chunks: string[] = []
  /** Index of the oldest live chunk. Evicting advances it (Array.shift is O(n)). */
  private head = 0
  private totalLength = 0
  private maxLength: number

  constructor(maxLength = BUFFER_MAX_LENGTH) {
    this.maxLength = Math.max(1, Math.round(maxLength))
  }

  push(data: string): void {
    this.chunks.push(data)
    this.totalLength += data.length
    this.trimToMaxLength()
  }

  setMaxLength(maxLength: number): void {
    this.maxLength = Math.max(1, Math.round(maxLength))
    this.trimToMaxLength()
  }

  private trimToMaxLength(): void {
    while (this.totalLength > this.maxLength && this.chunks.length - this.head > 1) {
      this.totalLength -= this.chunks[this.head].length
      this.chunks[this.head] = ''
      this.head++
    }
    if (this.totalLength > this.maxLength && this.chunks.length - this.head === 1) {
      const only = this.chunks[this.head]
      this.chunks[this.head] = only.slice(only.length - this.maxLength)
      this.totalLength = this.chunks[this.head].length
    }
    // Drop evicted slots once they are the larger part of the array.
    if (this.head > 1024 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head)
      this.head = 0
    }
  }

  read(): string {
    return this.head === 0 ? this.chunks.join('') : this.chunks.slice(this.head).join('')
  }

  clear(): void {
    this.chunks = []
    this.head = 0
    this.totalLength = 0
  }
}
