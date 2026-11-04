// Pauses a PTY on behalf of one or more owners (daemon clients, or main's
// in-process service) and makes sure it never stays paused by accident:
//  - the PTY resumes once every owner has resumed it,
//  - a disconnected owner's pauses are released (releaseOwner), and
//  - a safety valve resumes the PTY when no pause arrived for 10s, in case a
//    resume was lost. Owners re-send pause periodically while they need it.

export const PAUSE_SAFETY_TIMEOUT_MS = 10_000

export interface Pausable {
  pause(): void
  resume(): void
}

interface PauseState {
  owners: Set<unknown>
  timer: ReturnType<typeof setTimeout>
}

export class PauseValve {
  private paused = new Map<string, PauseState>()

  constructor(
    private lookup: (id: string) => Pausable | undefined,
    private timeoutMs = PAUSE_SAFETY_TIMEOUT_MS,
  ) {}

  isPaused(id: string): boolean {
    return this.paused.has(id)
  }

  pause(id: string, owner: unknown): void {
    const target = this.lookup(id)
    if (!target) return
    let state = this.paused.get(id)
    if (state) {
      clearTimeout(state.timer)
    } else {
      try { target.pause() } catch { return }
      state = { owners: new Set(), timer: undefined as unknown as ReturnType<typeof setTimeout> }
      this.paused.set(id, state)
    }
    state.owners.add(owner)
    state.timer = setTimeout(() => this.release(id), this.timeoutMs)
  }

  resume(id: string, owner: unknown): void {
    const state = this.paused.get(id)
    if (!state || !state.owners.delete(owner)) return
    if (state.owners.size === 0) this.release(id)
  }

  /** Release every pause held by `owner` (it disconnected). */
  releaseOwner(owner: unknown): void {
    for (const id of [...this.paused.keys()]) this.resume(id, owner)
  }

  /** The session ended: drop its state without touching the dead PTY. */
  forget(id: string): void {
    const state = this.paused.get(id)
    if (!state) return
    clearTimeout(state.timer)
    this.paused.delete(id)
  }

  dispose(): void {
    for (const state of this.paused.values()) clearTimeout(state.timer)
    this.paused.clear()
  }

  private release(id: string): void {
    const state = this.paused.get(id)
    if (!state) return
    clearTimeout(state.timer)
    this.paused.delete(id)
    try { this.lookup(id)?.resume() } catch { /* PTY already gone */ }
  }
}
