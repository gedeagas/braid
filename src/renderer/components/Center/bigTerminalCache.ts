import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { SearchAddon } from '@xterm/addon-search'
import * as ipc from '@/lib/ipc'
import { getTerminalMinimumContrastRatio, getTerminalTheme } from '@/themes/terminal'
import { createTerminal, registerPtyFinder } from '@/components/Right/terminalCache'
import { registerAgentStatusOsc, registerBraidOsc9 } from '@/lib/agentStatusOsc'
import { registerTitleDetection } from '@/lib/agentTitleDetection'
import { replayIntoTerminal, isReplaying, POST_REPLAY_MODE_RESET } from '@/lib/replayGuard'
import { isKnownAgentType, type AgentStatusPayload, type AgentStatusState, type AgentType } from '@/lib/agentStatus'
import { createCompletionCoordinator, type CompletionCoordinator } from '@/lib/agentCompletionCoordinator'
import { notifyTerminalStateChange, clearTerminalNotificationState } from '@/lib/terminalNotifications'
import { isCodexUserInputPromptText, readTerminalBufferTail } from '@/lib/codexTerminalDetection'
import { createTerminalCommandObserver, type TerminalCommandObserver } from '@/lib/terminalCommandRefresh'
import { useUIStore } from '@/store/ui'
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
export function getOrCreate(terminalId: string, worktreePath: string, initialCommand?: string, agentId?: string): BigTermEntry {
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
    disposed: false
  }
  cache.set(terminalId, entry)

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
    if (applied.stateChanged) {
      completionCoordinator.observeHookStatus(payload.state, payload.interrupted)
      notifyTerminalStateChange(terminalId, payload.state)
    }
  })

  registerTitleDetection(
    term,
    (result) => {
      const applied = updateStatus({ state: result.state, source: 'title', agentType: result.agentType ?? undefined })
      if (applied.stateChanged) {
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
    if (applied.stateChanged) {
      completionCoordinator.observeHookStatus(payload.state, false)
      notifyTerminalStateChange(terminalId, payload.state)
    }
  })

  if (expectedAgentType === 'codex') ensureCodexPromptScanListener(entry)

  entry.spawnPromise = (async () => {
    let hasScrollback = false

    // Attempt warm reattach to daemon session first
    let reattached = false
    try {
      const result = await ipc.pty.reattach(terminalId)
      if (result && result.snapshot) {
        reattached = true
        hasScrollback = true
        entry.ptyId = result.sessionId
        const commandObserver = createTerminalCommandObserver(worktreePath, { refreshWorktrees: true })
        entry.commandObserver = commandObserver
        replayIntoTerminal(terminalId, term, result.snapshot)
        replayIntoTerminal(terminalId, term, '\r\n\x1b[2m[session reconnected]\x1b[0m\r\n')
        replayIntoTerminal(terminalId, term, POST_REPLAY_MODE_RESET)
        ipc.pty.registerBigTerminal(result.sessionId, terminalId)
        term.onData((d) => {
          if (isReplaying(terminalId)) return
          commandObserver.accept(d)
          if (entry.ptyId && !entry.disposed) ipc.pty.write(entry.ptyId, d)
        })
      }
    } catch {
      // Reattach not available or failed - fall through to normal spawn
    }

    if (reattached || entry.disposed) return

    // Fall back to scrollback file replay + fresh spawn
    try {
      const scrollback = await ipc.pty.readScrollback(terminalId)
      if (scrollback && scrollback.length > 0) {
        hasScrollback = true
        // Replay under guard to suppress xterm auto-replies (DA1, DECRQM, etc.)
        replayIntoTerminal(terminalId, term, scrollback)
        replayIntoTerminal(terminalId, term, '\r\n\x1b[2m[history restored]\x1b[0m\r\n')
        // Clear stale terminal modes (cursor, mouse, focus, bracketed paste)
        replayIntoTerminal(terminalId, term, POST_REPLAY_MODE_RESET)
      }
    } catch {
      // ignore: best-effort replay
    }

    // Bail out if disposed while scrollback was loading
    if (entry.disposed) return

    try {
      // Pass BRAID_TERMINAL_ID so the hook script can identify this terminal
      // when POSTing to the loopback HTTP server.
      const ptyId = await ipc.pty.spawn(worktreePath, { BRAID_TERMINAL_ID: terminalId })
      // If disposed while spawn was in flight, kill the orphaned PTY immediately
      if (entry.disposed) {
        try { ipc.pty.kill(ptyId) } catch {}
        return
      }
      entry.ptyId = ptyId
      const commandObserver = createTerminalCommandObserver(worktreePath, { refreshWorktrees: true })
      entry.commandObserver = commandObserver
      ipc.pty.registerBigTerminal(ptyId, terminalId)
      term.onData((d) => {
        // Suppress xterm auto-replies during scrollback replay
        if (isReplaying(terminalId)) return
        commandObserver.accept(d)
        if (entry.ptyId && !entry.disposed) ipc.pty.write(entry.ptyId, d)
      })
      // Auto-run initialCommand only on fresh terminals (no restored scrollback)
      if (initialCommand && !hasScrollback) {
        commandObserver.accept(initialCommand + '\n')
        ipc.pty.write(ptyId, initialCommand + '\n')
      }
    } catch (err) {
      if (!entry.disposed) {
        term.write(`\r\n\x1b[31m[failed to spawn pty]\x1b[0m\r\n`)
      }
    }
  })()

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
  try { entry.term.dispose() } catch {}
  cache.delete(terminalId)
  try { ipc.pty.deleteScrollback(terminalId) } catch {}
  // Clear ephemeral agent status from store
  try { useUIStore.getState().clearBigTerminalStatus(terminalId) } catch {}
  // Dismiss any toasts and clear dedup state for this terminal
  try { useToastsStore.getState().dismissByTerminal(terminalId) } catch {}
  clearTerminalNotificationState(terminalId)
}

/** Dispose many at once (e.g. on worktree removal). */
export function disposeBigTerminals(terminalIds: string[]): void {
  for (const id of terminalIds) disposeBigTerminal(id)
}
