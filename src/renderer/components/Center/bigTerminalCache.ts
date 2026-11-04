import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { SearchAddon } from '@xterm/addon-search'
import * as ipc from '@/lib/ipc'
import { getTerminalMinimumContrastRatio, getTerminalTheme } from '@/themes/terminal'
import { createTerminal, registerPtyFinder } from '@/components/Right/terminalCache'
import { registerAgentStatusOsc, registerBraidOsc9 } from '@/lib/agentStatusOsc'
import { registerTitleDetection } from '@/lib/agentTitleDetection'
import { isReplaying } from '@/lib/replayGuard'
import { isKnownAgentType, type AgentStatusPayload, type AgentStatusState, type AgentType } from '@/lib/agentStatus'
import { createCompletionCoordinator, type CompletionCoordinator } from '@/lib/agentCompletionCoordinator'
import { notifyTerminalStateChange, clearTerminalNotificationState } from '@/lib/terminalNotifications'
import { isCodexUserInputPromptText, readTerminalBufferTail } from '@/lib/codexTerminalDetection'
import type { TerminalCommandObserver } from '@/lib/terminalCommandRefresh'
import { useUIStore } from '@/store/ui'
import { connectBigTerminal } from './bigTerminalConnect'
import { useToastsStore } from '@/store/toasts'

export interface BigTermEntry {
  terminalId: string
  worktreePath: string
  term: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
  ptyId: string | null
  resizeObserver: ResizeObserver | null
  /** Live WebGL addon instance, or null if using canvas renderer. */
  webglAddon: WebglAddon | null
  /** True if WebGL context was lost - prevents retry loops. */
  webglDisabledAfterContextLoss: boolean
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

// ── Hook status IPC listener (singleton) ─────────────────────────────────────
// The main process HTTP server forwards agent hook callbacks here.
// We route each status update to the matching terminal's store entry.

const VALID_STATES = new Set<string>(['working', 'blocked', 'waiting', 'done'])

interface StatusApplyResult {
  stateChanged: boolean
}

function applyTerminalStatus(terminalId: string, payload: AgentStatusPayload): StatusApplyResult {
  const before = useUIStore.getState().bigTerminalStatusById[terminalId]
  useUIStore.getState().updateBigTerminalStatus(terminalId, payload)
  const after = useUIStore.getState().bigTerminalStatusById[terminalId]

  return {
    stateChanged: after !== before && after != null && before?.state !== after.state,
  }
}

let hookListenerRegistered = false
function ensureHookListener(): void {
  if (hookListenerRegistered) return
  hookListenerRegistered = true
  ipc.pty.onAgentHookStatus((status) => {
    const { terminalId, state, agentType, toolName, interrupted } = status
    if (!VALID_STATES.has(state)) return

    const entry = cache.get(terminalId)
    if (!entry) return

    const payload: AgentStatusPayload = {
      state: state as AgentStatusState,
      source: 'hook',
      agentType: (agentType as AgentStatusPayload['agentType']) ?? 'claude',
      toolName: toolName ?? undefined,
    }
    const applied = applyTerminalStatus(terminalId, payload)
    if (payload.agentType === 'codex') {
      ensureCodexPromptScanListener(entry)
      scheduleCodexUserInputScan(entry)
    }
    if (applied.stateChanged) {
      entry.completionCoordinator.observeHookStatus(
        payload.state,
        interrupted ?? false
      )
      notifyTerminalStateChange(terminalId, payload.state)
    }
  })
}

function normalizeAgentType(agentId?: string): AgentType | undefined {
  return isKnownAgentType(agentId) ? agentId : undefined
}

function isKnownCodexTerminal(entry: BigTermEntry): boolean {
  if (entry.agentId === 'codex') return true
  const status = useUIStore.getState().bigTerminalStatusById[entry.terminalId]
  return status?.agentType === 'codex'
}

function scanCodexUserInputPrompt(entry: BigTermEntry): void {
  entry.codexPromptScanTimer = null
  if (entry.disposed) return
  if (isReplaying(entry.terminalId)) return
  if (!isKnownCodexTerminal(entry)) return
  if (!isCodexUserInputPromptText(readTerminalBufferTail(entry.term))) return

  const current = useUIStore.getState().bigTerminalStatusById[entry.terminalId]
  if (current?.state === 'waiting' && current.agentType === 'codex') return

  const payload: AgentStatusPayload = { state: 'waiting', source: 'terminal_scan', agentType: 'codex' }
  const applied = applyTerminalStatus(entry.terminalId, payload)
  if (applied.stateChanged) notifyTerminalStateChange(entry.terminalId, payload.state)
}

function scheduleCodexUserInputScan(entry: BigTermEntry): void {
  if (entry.disposed || isReplaying(entry.terminalId)) return
  if (!isKnownCodexTerminal(entry)) return
  if (entry.codexPromptScanTimer) return

  entry.codexPromptScanTimer = setTimeout(() => {
    scanCodexUserInputPrompt(entry)
  }, 80)
}

function ensureCodexPromptScanListener(entry: BigTermEntry): void {
  if (entry.codexPromptWriteDisposable) return
  entry.codexPromptWriteDisposable = entry.term.onWriteParsed(() => scheduleCodexUserInputScan(entry))
}

function updateEntryAgentId(entry: BigTermEntry, agentId?: string): void {
  if (!agentId) return
  entry.agentId = agentId
  if (agentId === 'codex') {
    ensureCodexPromptScanListener(entry)
    scheduleCodexUserInputScan(entry)
  }
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
  ensureHookListener()
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
    webglAddon: null,
    webglDisabledAfterContextLoss: false,
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

  // Register agent status tracking on ALL terminals.
  // OSC 9999: handles any agent that emits custom hook sequences.
  // Title detection: handles Claude (braille spinners), Gemini (✦/◇/✋),
  // Codex, Aider, and any agent with keyword-based titles.
  const updateStatus = (payload: AgentStatusPayload) => {
    const applied = applyTerminalStatus(terminalId, payload)
    if (payload.agentType === 'codex') {
      ensureCodexPromptScanListener(entry)
      scheduleCodexUserInputScan(entry)
    }
    return applied
  }

  registerAgentStatusOsc(term, (payload) => {
    const applied = updateStatus({ ...payload, source: 'hook' })
    // Replayed history sets the status but must not re-announce old events.
    if (applied.stateChanged && !isReplaying(terminalId)) {
      completionCoordinator.observeHookStatus(payload.state, payload.interrupted)
      notifyTerminalStateChange(terminalId, payload.state)
    }
  })

  registerTitleDetection(
    term,
    (result) => {
      const applied = updateStatus({ state: result.state, source: 'title', agentType: result.agentType ?? undefined })
      if (applied.stateChanged && !isReplaying(terminalId)) {
        completionCoordinator.observeTitleStatus(result.state)
        notifyTerminalStateChange(terminalId, result.state)
      }
    },
    { expectedAgentType }
  )

  // OSC 9 (Braid hooks): Claude Code hooks return terminalSequence with
  // OSC 9 braid:STATE[:TOOL] payloads. Secondary to HTTP but still useful.
  registerBraidOsc9(term, (payload) => {
    const applied = updateStatus({ ...payload, source: 'hook' })
    if (applied.stateChanged && !isReplaying(terminalId)) {
      completionCoordinator.observeHookStatus(payload.state, false)
      notifyTerminalStateChange(terminalId, payload.state)
    }
  })

  if (expectedAgentType === 'codex') ensureCodexPromptScanListener(entry)

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
export function listBigTerminalActivity(): Array<{ terminalId: string; lastInputAt: number; lastOutputAt: number; mobileInputLocked: boolean }> {
  return [...cache.values()].map((e) => ({
    terminalId: e.terminalId, lastInputAt: e.lastInputAt, lastOutputAt: e.lastOutputAt, mobileInputLocked: e.mobileInputLocked,
  }))
}

/**
 * Shut an idle agent terminal down to free its processes, keeping everything
 * needed to bring it back: the tab, its saved scrollback (written by main on
 * kill) and the agent's saved session. Opening the tab again replays the
 * history and resumes the agent through the normal cold path.
 */
export function hibernateBigTerminal(terminalId: string, agentType?: AgentType): boolean {
  const entry = cache.get(terminalId)
  if (!entry || !entry.ptyId) return false
  // Leave the cache first so the exit event finds no terminal to print into.
  teardown(entry)
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
  try { entry.webglAddon?.dispose() } catch {}
  entry.webglAddon = null
  entry.completionCoordinator.reset()
  if (entry.ptyId) {
    try { ipc.pty.kill(entry.ptyId) } catch {}
  }
  cache.delete(terminalId)
  try { entry.term.dispose() } catch {}
}

/** Dispose many at once (e.g. on worktree removal). */
export function disposeBigTerminals(terminalIds: string[]): void {
  for (const id of terminalIds) disposeBigTerminal(id)
}

/** PTY id backing a big terminal, or null when it hasn't spawned / isn't cached. */
export function getBigTerminalPtyId(terminalId: string): string | null {
  return cache.get(terminalId)?.ptyId ?? null
}
