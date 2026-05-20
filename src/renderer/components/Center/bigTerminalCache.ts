import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { SearchAddon } from '@xterm/addon-search'
import * as ipc from '@/lib/ipc'
import { createTerminal, registerPtyFinder } from '@/components/Right/terminalCache'
import { registerAgentStatusOsc, registerBraidOsc9 } from '@/lib/agentStatusOsc'
import { registerTitleDetection } from '@/lib/agentTitleDetection'
import { replayIntoTerminal, isReplaying, POST_REPLAY_MODE_RESET } from '@/lib/replayGuard'
import type { AgentStatusPayload, AgentStatusState } from '@/lib/agentStatus'
import { createCompletionCoordinator, type CompletionCoordinator } from '@/lib/agentCompletionCoordinator'
import { useUIStore } from '@/store/ui'

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
      agentType: (agentType as AgentStatusPayload['agentType']) ?? 'claude',
      toolName: toolName ?? undefined,
    }
    useUIStore.getState().updateBigTerminalStatus(terminalId, payload)
    entry.completionCoordinator.observeHookStatus(
      payload.state,
      interrupted ?? false
    )
  })
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
export function getOrCreate(terminalId: string, worktreePath: string, initialCommand?: string): BigTermEntry {
  ensureFinderRegistered()
  ensureHookListener()
  const existing = cache.get(terminalId)
  if (existing) return existing

  const { term, fitAddon, searchAddon } = createTerminal()

  // Completion coordinator fires when an agent finishes a task.
  // Currently logs - can be wired to toast notifications or dock badge later.
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
    spawnPromise: Promise.resolve(),
    disposed: false
  }
  cache.set(terminalId, entry)

  // Register agent status tracking on ALL terminals.
  // OSC 9999: handles any agent that emits custom hook sequences.
  // Title detection: handles Claude (braille spinners), Gemini (✦/◇/✋),
  // Codex, Aider, and any agent with keyword-based titles.
  const updateStatus = (payload: AgentStatusPayload) =>
    useUIStore.getState().updateBigTerminalStatus(terminalId, payload)

  registerAgentStatusOsc(term, (payload) => {
    updateStatus(payload)
    completionCoordinator.observeHookStatus(payload.state, payload.interrupted)
  })

  registerTitleDetection(term, (result) => {
    updateStatus({ state: result.state, agentType: result.agentType ?? undefined })
    completionCoordinator.observeTitleStatus(result.state)
  })

  // OSC 9 (Braid hooks): Claude Code hooks return terminalSequence with
  // OSC 9 braid:STATE[:TOOL] payloads. Secondary to HTTP but still useful.
  registerBraidOsc9(term, (payload) => {
    updateStatus(payload)
    completionCoordinator.observeHookStatus(payload.state, false)
  })

  entry.spawnPromise = (async () => {
    let hasScrollback = false
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
      ipc.pty.registerBigTerminal(ptyId, terminalId)
      term.onData((d) => {
        // Suppress xterm auto-replies during scrollback replay
        if (isReplaying(terminalId)) return
        if (entry.ptyId && !entry.disposed) ipc.pty.write(entry.ptyId, d)
      })
      // Auto-run initialCommand only on fresh terminals (no restored scrollback)
      if (initialCommand && !hasScrollback) {
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
}

/** Dispose many at once (e.g. on worktree removal). */
export function disposeBigTerminals(terminalIds: string[]): void {
  for (const id of terminalIds) disposeBigTerminal(id)
}
