import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import * as ipc from '@/lib/ipc'
import { getTerminalMinimumContrastRatio, getTerminalTheme } from '@/themes/terminal'
import { createTerminal, registerPtyFinder } from '@/components/Right/terminalCache'
import { initPtyOutputRouting } from '@/lib/ptyOutput/router'
import { forgetShown } from '@/lib/ptyOutput/visibility'
import { bindWebglPoolToVisibility, webglPool } from '@/lib/webglPool'
import { bindRevealOnShow } from '@/lib/ptyOutput/revealOnShow'
import { initPtyFeatures } from '@/lib/ptyFeatures'
import { isKnownAgentType, type AgentType } from '@/lib/agentStatus'
import { createCompletionCoordinator, type CompletionCoordinator } from '@/lib/agentCompletionCoordinator'
import { clearTerminalNotificationState } from '@/lib/terminalNotifications'
import type { TerminalCommandObserver } from '@/lib/terminalCommandRefresh'
import { useUIStore } from '@/store/ui'
import { connectBigTerminal } from './bigTerminalConnect'
import { ensureStatusListeners, registerRendererDetectors, updateEntryAgentId } from './bigTerminalStatus'
import { useToastsStore } from '@/store/toasts'

export interface BigTermEntry {
  terminalId: string
  worktreePath: string
  term: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
  ptyId: string | null
  resizeObserver: ResizeObserver | null
  /** rAF ID for pending fit(), used to coalesce ResizeObserver callbacks. */
  pendingFitRafId: number | null
  /** Completion coordinator for agent task completion detection. */
  completionCoordinator: CompletionCoordinator
  /** Agent catalog id from tab metadata, when launched as a known CLI agent. */
  agentId?: string
  /** Debounced scan for Codex request_user_input panes. */
  codexPromptScanTimer: ReturnType<typeof setTimeout> | null
  /** xterm write listener used only for Codex prompt fallback scanning. */
  codexPromptWriteDisposable: IDisposable | null
  /** Watches typed/launched CLI commands and routes resource refreshes after mutations. */
  commandObserver: TerminalCommandObserver | null
  spawnPromise: Promise<void>
  /** Set by disposeBigTerminal so the in-flight spawn can bail out. */
  disposed: boolean
  /**
   * True while a paired mobile device is driving this terminal. Desktop
   * keystrokes are NOT forwarded to the PTY (the phone owns input); instead they
   * trigger a take-back. Set by BigTerminalView.
   */
  mobileInputLocked: boolean
  /** Invoked when the desktop types while locked - typing = desktop take-back. */
  onDesktopInputWhileLocked: (() => void) | null
  /** Last keystroke / last rendered output (ms), for idle hibernation. */
  lastInputAt: number
  lastOutputAt: number
  /** A BigTerminalView shows this terminal (see lib/ptyOutput/visibility). */
  shown?: boolean
}

const cache = new Map<string, BigTermEntry>()

let finderRegistered = false
function ensureFinderRegistered(): void {
  if (finderRegistered) return
  finderRegistered = true
  // Big terminals must get output even if the right panel never mounted.
  initPtyOutputRouting()
  bindWebglPoolToVisibility()
  bindRevealOnShow()
  void initPtyFeatures()
  registerPtyFinder((ptyId) => {
    for (const entry of cache.values()) {
      if (entry.ptyId === ptyId) return { term: entry.term }
    }
    return undefined
  })
}

function normalizeAgentType(agentId?: string): AgentType | undefined {
  return isKnownAgentType(agentId) ? agentId : undefined
}

// ── Warm terminals without an xterm ─────────────────────────────────────────
// With a daemon that offloads hidden terminals, startup warm-up attaches live
// big terminals in main only (status comes from the daemon). The xterm is
// built when the tab is opened. These records keep them visible to agent
// hibernation meanwhile.

interface WarmRecord { terminalId: string; ptyId: string; lastInputAt: number; lastOutputAt: number }
const warm = new Map<string, WarmRecord>()

export function registerWarmBigTerminal(terminalId: string, ptyId: string): void {
  if (cache.has(terminalId)) return
  const now = Date.now()
  warm.set(terminalId, { terminalId, ptyId, lastInputAt: now, lastOutputAt: now })
}

export function isWarmBigTerminal(terminalId: string): boolean {
  return warm.has(terminalId)
}

/** The tab has an xterm (opened, or being opened). */
export function hasBigTerminal(terminalId: string): boolean {
  return cache.has(terminalId)
}

/** Hook and daemon status for every big terminal, with or without an xterm. */
export function ensureBigTerminalStatusListeners(): void {
  ensureStatusListeners((id) => cache.get(id))
}

/**
 * Return existing entry or build a new one: create xterm, replay scrollback, spawn PTY.
 * Pass `initialCommand` to auto-run a command after the first PTY spawn (not on restore).
 *
 * Agent status tracking uses three complementary mechanisms:
 *   1. HTTP hook callbacks (primary): Braid installs Claude Code hooks that POST
 *      to a loopback server in the main process, forwarded here via IPC.
 *   2. OSC 9999 / OSC 9: custom terminal sequences parsed by xterm.js.
 *   3. Title detection (fallback): watches braille spinners, Gemini markers, etc.
 */
export function getOrCreate(
  terminalId: string, worktreePath: string, initialCommand?: string, agentId?: string, initialInput?: string,
  options: { reattachOnly?: boolean } = {},
): BigTermEntry {
  ensureFinderRegistered()
  ensureBigTerminalStatusListeners()
  // Opening a warm tab builds its xterm now (reattach restores the screen).
  warm.delete(terminalId)
  const existing = cache.get(terminalId)
  if (existing) {
    existing.term.options.scrollback = useUIStore.getState().terminalScrollback
    updateEntryAgentId(existing, agentId)
    return existing
  }

  const { term, fitAddon, searchAddon } = createTerminal()
  const expectedAgentType = normalizeAgentType(agentId)

  // Completion coordinator fires when an agent finishes a task.
  // Toast + desktop notifications are handled by notifyTerminalStateChange.
  const completionCoordinator = createCompletionCoordinator({
    onComplete: (source, interrupted) => {
      console.debug(`[terminal:${terminalId}] Agent completed (source=${source}, interrupted=${interrupted})`)
    }
  })

  const entry: BigTermEntry = {
    terminalId,
    worktreePath,
    term,
    fitAddon,
    searchAddon,
    ptyId: null,
    resizeObserver: null,
    pendingFitRafId: null,
    completionCoordinator,
    agentId,
    codexPromptScanTimer: null,
    codexPromptWriteDisposable: null,
    commandObserver: null,
    spawnPromise: Promise.resolve(),
    disposed: false,
    mobileInputLocked: false,
    onDesktopInputWhileLocked: null,
    lastInputAt: Date.now(),
    lastOutputAt: Date.now(),
  }
  cache.set(terminalId, entry)
  term.onData(() => { entry.lastInputAt = Date.now() })
  term.onWriteParsed(() => { entry.lastOutputAt = Date.now() })

  // Renderer-side status detection (only while the daemon doesn't provide it).
  registerRendererDetectors(entry, expectedAgentType)

  // A warm-up whose session died meanwhile is dropped, unless a view mounted
  // it in the meantime (the user opened the tab): that one restores normally.
  const onReattachFailed = options.reattachOnly
    ? () => {
      if (entry.resizeObserver !== null || cache.get(terminalId) !== entry) return false
      teardown(entry)
      return true
    }
    : undefined
  entry.spawnPromise = connectBigTerminal(entry, { initialCommand, initialInput, onReattachFailed })

  return entry
}

export function updateBigTerminalAgentId(terminalId: string, agentId?: string): void {
  const entry = cache.get(terminalId)
  if (!entry) return
  updateEntryAgentId(entry, agentId)
}

/** Re-theme all cached big terminals when the app theme changes. */
export function reThemeAllBigTerminals(): void {
  const theme = getTerminalTheme()
  const minimumContrastRatio = getTerminalMinimumContrastRatio()
  for (const entry of cache.values()) {
    entry.term.options.theme = theme
    entry.term.options.minimumContrastRatio = minimumContrastRatio
  }
}

/** Update scrollback on all cached big terminals. */
export function updateScrollbackAllBigTerminals(lines: number): void {
  for (const entry of cache.values()) {
    entry.term.options.scrollback = lines
  }
}

/** Kill PTY, dispose xterm, remove from cache, and delete persisted scrollback. */
export function disposeBigTerminal(terminalId: string): void {
  const entry = cache.get(terminalId)
  const warmRecord = warm.get(terminalId)
  if (warmRecord) {
    warm.delete(terminalId)
    try { ipc.pty.kill(warmRecord.ptyId) } catch {}
    forgetShown(warmRecord.ptyId)
    try { useUIStore.getState().clearBigTerminalStatus(terminalId) } catch {}
  }
  if (!entry) {
    // Still attempt to delete any orphaned scrollback file
    try { ipc.pty.deleteScrollback(terminalId) } catch {}
    return
  }
  teardown(entry)
  try { ipc.pty.deleteScrollback(terminalId) } catch {}
  // Clear ephemeral agent status from store
  try { useUIStore.getState().clearBigTerminalStatus(terminalId) } catch {}
  // Dismiss any toasts and clear dedup state for this terminal
  try { useToastsStore.getState().dismissByTerminal(terminalId) } catch {}
  clearTerminalNotificationState(terminalId)
}

/** Snapshot of a cached terminal, for the idle hibernation sweep. */
export function listBigTerminalActivity(
  lastOutputById?: ReadonlyMap<string, number>,
): Array<{ terminalId: string; lastInputAt: number; lastOutputAt: number; mobileInputLocked: boolean }> {
  const live = [...cache.values()].map((e) => ({
    terminalId: e.terminalId, lastInputAt: e.lastInputAt, lastOutputAt: e.lastOutputAt, mobileInputLocked: e.mobileInputLocked,
  }))
  // Warm terminals have no xterm: their last output comes from the daemon.
  const background = [...warm.values()].map((w) => ({
    terminalId: w.terminalId,
    lastInputAt: w.lastInputAt,
    lastOutputAt: Math.max(w.lastOutputAt, lastOutputById?.get(w.terminalId) ?? 0),
    mobileInputLocked: false,
  }))
  return [...live, ...background]
}

/**
 * Shut an idle agent terminal down to free its processes, keeping everything
 * needed to bring it back: the tab, its saved scrollback (written by main on
 * kill) and the agent's saved session. Opening the tab again replays the
 * history and resumes the agent through the normal cold path.
 */
export function hibernateBigTerminal(terminalId: string, agentType?: AgentType): boolean {
  const entry = cache.get(terminalId)
  const warmRecord = warm.get(terminalId)
  if (warmRecord && !entry) {
    // Main writes the scrollback file on kill, from its mirror of the output.
    warm.delete(terminalId)
    try { ipc.pty.kill(warmRecord.ptyId) } catch {}
    forgetShown(warmRecord.ptyId)
  } else if (!entry || !entry.ptyId) {
    return false
  } else {
    // Leave the cache first so the exit event finds no terminal to print into.
    teardown(entry)
  }
  try { useUIStore.getState().clearBigTerminalStatus(terminalId) } catch {}
  try { useUIStore.getState().seedRestoredBigTerminalStatus([{ terminalId, agentType }]) } catch {}
  return true
}

function teardown(entry: BigTermEntry): void {
  const terminalId = entry.terminalId
  entry.disposed = true
  try { entry.resizeObserver?.disconnect() } catch {}
  if (entry.pendingFitRafId !== null) {
    cancelAnimationFrame(entry.pendingFitRafId)
    entry.pendingFitRafId = null
  }
  if (entry.codexPromptScanTimer) {
    clearTimeout(entry.codexPromptScanTimer)
    entry.codexPromptScanTimer = null
  }
  try { entry.codexPromptWriteDisposable?.dispose() } catch {}
  entry.codexPromptWriteDisposable = null
  try { entry.commandObserver?.dispose() } catch {}
  entry.commandObserver = null
  webglPool.forget(entry.term)
  entry.completionCoordinator.reset()
  if (entry.ptyId) {
    try { ipc.pty.kill(entry.ptyId) } catch {}
    forgetShown(entry.ptyId)
  }
  cache.delete(terminalId)
  try { entry.term.dispose() } catch {}
}

/** Dispose many at once (e.g. on worktree removal). */
export function disposeBigTerminals(terminalIds: string[]): void {
  for (const id of terminalIds) disposeBigTerminal(id)
}

/** PTY id backing a big terminal (open, or warm without an xterm), or null when it hasn't spawned. */
export function getBigTerminalPtyId(terminalId: string): string | null {
  return cache.get(terminalId)?.ptyId ?? warm.get(terminalId)?.ptyId ?? null
}
