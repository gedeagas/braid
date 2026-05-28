import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import * as ipc from '@/lib/ipc'
import { getTerminalMinimumContrastRatio, getTerminalTheme } from '@/themes/terminal'
import { useUIStore } from '@/store/ui'
import { SK } from '@/lib/storageKeys'
import type { TerminalCommandObserver } from '@/lib/terminalCommandRefresh'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TermTab {
  id: string
  label: string
  ptyId: string | null
  term: Terminal
  fitAddon: FitAddon
  resizeObserver: ResizeObserver | null
  commandObserver?: TerminalCommandObserver | null
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
  return `rt-${Date.now()}-${_tabCounter}`
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
    tab.commandObserver?.dispose()
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
    minimumContrastRatio: getTerminalMinimumContrastRatio(),
    cursorBlink: true,
    allowProposedApi: true
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  // Clickable URLs - use a custom handler because xterm's default calls
  // window.open() without a URL, which Electron's setWindowOpenHandler
  // sees as about:blank and denies.
  term.loadAddon(new WebLinksAddon((_event, uri) => {
    ipc.shell.openExternal(uri)
  }))

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
 * Returns the addon instance (for later dispose/reattach), or null on failure.
 */
export function activateWebgl(term: Terminal, onContextLoss?: () => void): WebglAddon | null {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      onContextLoss?.()
      webgl.dispose()
    })
    term.loadAddon(webgl)
    // Repaint immediately so the terminal isn't blank after attach
    try { term.refresh(0, term.rows - 1) } catch { /* ignore */ }
    console.debug('[terminal] WebGL renderer activated')
    return webgl
  } catch (e) {
    console.debug('[terminal] WebGL unavailable, using canvas renderer', e)
    return null
  }
}

/**
 * Safely dispose a WebGL addon. Call before DOM reparenting to avoid
 * silent context corruption (Chromium can invalidate without firing contextlost).
 */
export function disposeWebgl(addon: WebglAddon | null): void {
  if (!addon) return
  try { addon.dispose() } catch { /* ignore */ }
}

// ── Right-panel tab ID persistence (for daemon reattach across reloads) ──────

interface PersistedTabInfo {
  id: string
  label: string
}

/** Save right-panel tab metadata for a worktree to localStorage. */
export function saveRightTerminalTabs(worktreePath: string, tabs: TermTab[]): void {
  try {
    const data: PersistedTabInfo[] = tabs
      .filter((t) => t.id !== SETUP_TAB_ID && t.id !== RUN_TAB_ID)
      .map((t) => ({ id: t.id, label: t.label }))
    localStorage.setItem(SK.rightTerminalTabsPrefix + worktreePath, JSON.stringify(data))
  } catch { /* ignore */ }
}

/** Load persisted right-panel tab metadata for a worktree. */
export function loadRightTerminalTabs(worktreePath: string): PersistedTabInfo[] {
  try {
    const raw = localStorage.getItem(SK.rightTerminalTabsPrefix + worktreePath)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is { id: unknown; label: unknown } =>
        typeof x === 'object' && x !== null && 'id' in x && 'label' in x)
      .map((x) => ({ id: String(x.id), label: String(x.label) }))
  } catch {
    return []
  }
}

/** Re-theme all cached terminals when the app theme changes */
export function reThemeAllTerminals(): void {
  const theme = getTerminalTheme()
  const minimumContrastRatio = getTerminalMinimumContrastRatio()
  for (const cached of terminalCache.values()) {
    for (const tab of cached.tabs) {
      tab.term.options.theme = theme
      tab.term.options.minimumContrastRatio = minimumContrastRatio
    }
  }
}
