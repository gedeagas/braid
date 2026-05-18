import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import * as ipc from '@/lib/ipc'
import { getTerminalTheme } from '@/themes/terminal'
import { useUIStore } from '@/store/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TermTab {
  id: string
  label: string
  ptyId: string | null
  term: Terminal
  fitAddon: FitAddon
  resizeObserver: ResizeObserver | null
}

export interface CachedTerminals {
  tabs: TermTab[]
  activeTabId: string | null
}

export interface RenameState {
  tabId: string
  draft: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const SETUP_TAB_ID = '__setup__'
export const RUN_TAB_ID = '__run__'

// ── Module-level cache ────────────────────────────────────────────────────────

export const terminalCache = new Map<string, CachedTerminals>()

let _tabCounter = 0
export function nextTabId(): string {
  _tabCounter++
  return `tab-${_tabCounter}`
}


let globalPtyRoutingInitialized = false

/** External PTY finder — lets other caches (e.g. bigTerminalCache) participate in routing. */
export type PtyFinder = (ptyId: string) => { term: Terminal } | undefined
const finders: PtyFinder[] = []
export function registerPtyFinder(finder: PtyFinder): void {
  finders.push(finder)
}

/** Search all cached terminals across all worktrees to find a tab by ptyId */
function findTabByPtyId(ptyId: string): { term: Terminal } | undefined {
  for (const cached of terminalCache.values()) {
    const tab = cached.tabs.find((t) => t.ptyId === ptyId)
    if (tab) return tab
  }
  for (const finder of finders) {
    const found = finder(ptyId)
    if (found) return found
  }
  return undefined
}

/** Initialize global PTY data/exit routing — called once, never cleaned up */
export function initGlobalPtyRouting(): void {
  if (globalPtyRoutingInitialized) return
  globalPtyRoutingInitialized = true

  ipc.pty.onData((id, data) => {
    findTabByPtyId(id)?.term.write(data)
  })
  ipc.pty.onExit((id) => {
    findTabByPtyId(id)?.term.write('\r\n\x1b[2m[Process exited]\x1b[0m\r\n')
  })
}

/** Kill all PTYs and dispose all xterms for a specific worktree. Call on worktree removal. */
export function cleanupTerminals(worktreePath: string): void {
  const cached = terminalCache.get(worktreePath)
  if (!cached) return
  for (const tab of cached.tabs) {
    if (tab.ptyId) ipc.pty.kill(tab.ptyId)
    tab.resizeObserver?.disconnect()
    tab.term.dispose()
  }
  terminalCache.delete(worktreePath)
}

export function createTerminal(): { term: Terminal; fitAddon: FitAddon; searchAddon: SearchAddon } {
  const term = new Terminal({
    theme: getTerminalTheme(),
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: useUIStore.getState().terminalFontSize,
    cursorBlink: true,
    allowProposedApi: true
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  // Clickable URLs
  term.loadAddon(new WebLinksAddon())

  // Full-width CJK / emoji rendering
  const unicode11 = new Unicode11Addon()
  term.loadAddon(unicode11)
  term.unicode.activeVersion = '11'

  // Find in terminal
  const searchAddon = new SearchAddon()
  term.loadAddon(searchAddon)

  // Font ligatures (can fail if font metrics unavailable)
  try { term.loadAddon(new LigaturesAddon()) } catch { /* ignore */ }

  return { term, fitAddon, searchAddon }
}

/**
 * Activate GPU-accelerated WebGL renderer. Must be called AFTER term.open(el).
 * Falls back silently to the default canvas renderer on failure.
 */
export function activateWebgl(term: Terminal): void {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => { webgl.dispose() })
    term.loadAddon(webgl)
  } catch {
    // WebGL unavailable - canvas renderer is fine
  }
}

/** Re-theme all cached terminals when the app theme changes */
export function reThemeAllTerminals(): void {
  const theme = getTerminalTheme()
  for (const cached of terminalCache.values()) {
    for (const tab of cached.tabs) {
      tab.term.options.theme = theme
    }
  }
}
