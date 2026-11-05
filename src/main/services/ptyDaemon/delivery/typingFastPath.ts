// Typing echo fast path. Output that arrives right after the user typed into a
// terminal (the echo, or a small TUI redraw) skips the 2ms batch and is sent
// at once, so typing never waits on batching. A per-terminal budget, refilled
// on every keystroke, keeps a flood that starts right after a keystroke from
// bypassing the queue.

export interface FastPathLimits {
  /** Output counts as an echo for this long after a keystroke. */
  windowMs: number
  /** Largest plain-text echo. */
  maxChars: number
  /** Largest echo that contains escape sequences (TUI redraw). */
  maxCharsWithEscapes: number
  /** Fast-path characters allowed per keystroke. */
  budget: number
}

export const DEFAULT_FAST_PATH: FastPathLimits = {
  windowMs: 100,
  maxChars: 1024,
  maxCharsWithEscapes: 16 * 1024,
  budget: 32 * 1024,
}

interface InputState {
  at: number
  budget: number
}

export class TypingFastPath {
  private state = new Map<string, InputState>()

  constructor(private limits: FastPathLimits = DEFAULT_FAST_PATH) {}

  /** The user typed into `id`. */
  noteInput(id: string): void {
    this.state.set(id, { at: Date.now(), budget: this.limits.budget })
  }

  /** Whether `data` may skip the queue; consumes budget when it may. */
  take(id: string, data: string): boolean {
    const s = this.state.get(id)
    if (!s || Date.now() - s.at > this.limits.windowMs) return false
    const max = data.includes('\x1b') ? this.limits.maxCharsWithEscapes : this.limits.maxChars
    if (data.length >= max || data.length > s.budget) return false
    s.budget -= data.length
    return true
  }

  forget(id: string): void {
    this.state.delete(id)
  }
}
