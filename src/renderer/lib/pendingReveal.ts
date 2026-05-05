/*
 * Shared "jump to line" target that survives the gap between a caller (e.g.
 * SearchResultRow) requesting a file open and the lazy-loaded FileViewer
 * finishing its mount. A custom event alone isn't enough because the event
 * fires before any listener exists on the very first open.
*/

type Target = { path: string; line: number }

let pending: Target | null = null

export const pendingReveal = {
  set(target: Target): void {
    pending = target
  },
  peek(): Target | null {
    return pending
  },
  consume(path: string): Target | null {
    if (pending && pending.path === path) {
      const taken = pending
      pending = null
      return taken
    }
    return null
  },
  clear(): void {
    pending = null
  },
}
