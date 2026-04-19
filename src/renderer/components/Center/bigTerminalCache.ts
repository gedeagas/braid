import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import * as ipc from '@/lib/ipc'
import { createTerminal, registerPtyFinder } from '@/components/Right/terminalCache'
import { getTerminalTheme } from '@/themes/terminal'

export interface BigTermEntry {
  terminalId: string
  worktreePath: string
  term: Terminal
  fitAddon: FitAddon
  ptyId: string | null
  resizeObserver: ResizeObserver | null
  spawnPromise: Promise<void>
}

const cache = new Map<string, BigTermEntry>()

let finderRegistered = false
function ensureFinderRegistered(): void {
  if (finderRegistered) return
  finderRegistered = true
  registerPtyFinder((ptyId) => {
    for (const entry of cache.values()) {
      if (entry.ptyId === ptyId) return { term: entry.term }
    }
    return undefined
  })
}

/** Return existing entry or build a new one: create xterm, replay scrollback, spawn PTY. */
export function getOrCreate(terminalId: string, worktreePath: string): BigTermEntry {
  ensureFinderRegistered()
  const existing = cache.get(terminalId)
  if (existing) return existing

  const { term, fitAddon } = createTerminal()
  const entry: BigTermEntry = {
    terminalId,
    worktreePath,
    term,
    fitAddon,
    ptyId: null,
    resizeObserver: null,
    spawnPromise: Promise.resolve()
  }
  cache.set(terminalId, entry)

  entry.spawnPromise = (async () => {
    try {
      const scrollback = await ipc.pty.readScrollback(terminalId)
      if (scrollback && scrollback.length > 0) {
        term.write(scrollback)
        term.write('\r\n\x1b[2m[history restored]\x1b[0m\r\n')
      }
    } catch {
      // ignore: best-effort replay
    }

    try {
      const ptyId = await ipc.pty.spawn(worktreePath)
      entry.ptyId = ptyId
      ipc.pty.registerBigTerminal(ptyId, terminalId)
      term.onData((d) => {
        if (entry.ptyId) ipc.pty.write(entry.ptyId, d)
      })
    } catch (err) {
      term.write(`\r\n\x1b[31m[failed to spawn pty: ${String(err)}]\x1b[0m\r\n`)
    }
  })()

  return entry
}

/** Look up an entry without creating one. */
export function peek(terminalId: string): BigTermEntry | undefined {
  return cache.get(terminalId)
}

/** Kill PTY, dispose xterm, remove from cache, and delete persisted scrollback. */
export function disposeBigTerminal(terminalId: string): void {
  const entry = cache.get(terminalId)
  if (!entry) {
    // Still attempt to delete any orphaned scrollback file
    try { ipc.pty.deleteScrollback(terminalId) } catch {}
    return
  }
  try { entry.resizeObserver?.disconnect() } catch {}
  if (entry.ptyId) {
    try { ipc.pty.kill(entry.ptyId) } catch {}
  }
  try { entry.term.dispose() } catch {}
  cache.delete(terminalId)
  try { ipc.pty.deleteScrollback(terminalId) } catch {}
}

/** Dispose many at once (e.g. on worktree removal). */
export function disposeAllForWorktree(terminalIds: string[]): void {
  for (const id of terminalIds) disposeBigTerminal(id)
}

/** Re-theme all cached big terminals when the app theme changes. */
export function reThemeAllBigTerminals(): void {
  const theme = getTerminalTheme()
  for (const entry of cache.values()) entry.term.options.theme = theme
}
