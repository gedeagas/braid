// Screens of sessions whose PTY just exited, kept briefly so a client can
// still take a final snapshot: a hidden terminal got none of the output its
// shell printed before exiting (`sleep 1; echo result; exit` in a background
// tab), and main fetches it right after the exit to show on the next reveal.

import type { HeadlessSnapshot } from '../protocol'

/** How long an exited session's screen stays available. */
export const EXITED_SCREEN_MS = 10_000

interface Screen {
  snapshot(): Promise<HeadlessSnapshot>
  dispose(): void
}

export class ExitedScreens {
  private screens = new Map<string, { screen: Screen; timer: ReturnType<typeof setTimeout> }>()

  keep(sessionId: string, screen: Screen): void {
    this.drop(sessionId)
    const timer = setTimeout(() => this.drop(sessionId), EXITED_SCREEN_MS)
    timer.unref?.()
    this.screens.set(sessionId, { screen, timer })
  }

  snapshot(sessionId: string): Promise<HeadlessSnapshot> | null {
    return this.screens.get(sessionId)?.screen.snapshot() ?? null
  }

  drop(sessionId: string): void {
    const kept = this.screens.get(sessionId)
    if (!kept) return
    clearTimeout(kept.timer)
    kept.screen.dispose()
    this.screens.delete(sessionId)
  }

  dispose(): void {
    for (const id of [...this.screens.keys()]) this.drop(id)
  }
}
