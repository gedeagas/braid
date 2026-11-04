// Stage B of output flow control: when main's queue for a terminal grows past
// the high mark (the renderer can't keep up), ask the producing program to
// stop by pausing its PTY. Resume once the queue has drained below the low
// mark. The gap between the marks prevents flapping.
//
// The daemon resumes a session on its own if no pause arrives for a while (a
// safety valve against a lost resume), so the pause is re-sent periodically
// while the queue stays high.

export interface PauseTarget {
  pause(id: string): void
  resume(id: string): void
}

export interface PauseLimits {
  high: number
  low: number
  repeatMs: number
}

export class ProducerPause {
  private paused = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private enabled = false

  constructor(private target: PauseTarget, private limits: PauseLimits) {}

  /** Only producers that support pausing get pause requests (see daemon features). */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    if (!enabled) this.resumeAll()
    this.enabled = enabled
  }

  isPaused(id: string): boolean {
    return this.paused.has(id)
  }

  /** Feed the current queue length for a terminal. */
  update(id: string, queued: number): void {
    if (!this.enabled) return
    const pausedAt = this.paused.get(id)
    if (queued > this.limits.high) {
      if (pausedAt === undefined) {
        this.target.pause(id)
        this.paused.set(id, Date.now())
        this.arm()
      }
    } else if (queued < this.limits.low && pausedAt !== undefined) {
      this.paused.delete(id)
      this.target.resume(id)
    }
  }

  /** Terminal went away: drop its state without sending anything. */
  forget(id: string): void {
    this.paused.delete(id)
  }

  /** The daemon connection dropped, and the daemon resumed our sessions itself. */
  forgetAll(): void {
    this.paused.clear()
  }

  resumeAll(): void {
    const ids = [...this.paused.keys()]
    this.paused.clear()
    for (const id of ids) this.target.resume(id)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.paused.clear()
  }

  /** Wake up when the oldest pause is due again. */
  private arm(): void {
    if (this.timer || this.paused.size === 0) return
    const oldest = Math.min(...this.paused.values())
    const delay = Math.max(0, oldest + this.limits.repeatMs - Date.now())
    this.timer = setTimeout(() => this.repeat(), delay)
  }

  private repeat(): void {
    this.timer = null
    if (!this.enabled || this.paused.size === 0) return
    const now = Date.now()
    for (const [id, at] of this.paused) {
      if (now - at >= this.limits.repeatMs) {
        this.target.pause(id)
        this.paused.set(id, now)
      }
    }
    this.arm()
  }
}
