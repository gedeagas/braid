// Agent status for big terminals: Mission Control, the sidebar agent counts,
// notifications and agent hibernation all read it from the UI store.
//
// Sources:
//  1. HTTP hook callbacks (primary): Claude Code hooks POST to a loopback
//     server in main, forwarded here.
//  2. OSC 9999 / OSC 9 braid sequences, 3. title markers, 4. the Codex
//     request_user_input pane. With a daemon that offloads hidden terminals
//     (status-events), the daemon runs 2-4 on its headless terminal and sends
//     the results (pty:agentStatus), so terminals without an xterm still have
//     status; the renderer's own detectors are then off so nothing fires
//     twice. With an older daemon the renderer detects, as before.

import * as ipc from '@/lib/ipc'
import { registerAgentStatusOsc, registerBraidOsc9 } from '@/lib/agentStatusOsc'
import { registerTitleDetection } from '@/lib/agentTitleDetection'
import { isCodexUserInputPromptText, readTerminalBufferTail } from '@/lib/codexTerminalDetection'
import { isReplaying } from '@/lib/replayGuard'
import { isOffloadEnabled } from '@/lib/ptyFeatures'
import { isKnownAgentType, type AgentStatusPayload, type AgentStatusState, type AgentType } from '@/lib/agentStatus'
import { notifyTerminalStateChange } from '@/lib/terminalNotifications'
import { useUIStore } from '@/store/ui'
import type { DaemonAgentStatusEvent } from '@shared/terminal-offload'
import type { BigTermEntry } from './bigTerminalCache'

const VALID_STATES = new Set<string>(['working', 'blocked', 'waiting', 'done'])

/** Only big terminals have agent status (right-panel "rt-" tabs don't). */
const isBigTerminalId = (id: string): boolean => id.startsWith('bt-')

export function applyTerminalStatus(terminalId: string, payload: AgentStatusPayload): { stateChanged: boolean } {
  const before = useUIStore.getState().bigTerminalStatusById[terminalId]
  useUIStore.getState().updateBigTerminalStatus(terminalId, payload)
  const after = useUIStore.getState().bigTerminalStatusById[terminalId]
  return { stateChanged: after !== before && after != null && before?.state !== after.state }
}

/** Apply one status the daemon detected. `entry` exists when the tab has an xterm. */
export function applyDaemonStatus(event: DaemonAgentStatusEvent, entry: BigTermEntry | undefined): void {
  const { terminalId, kind, status, replayed } = event
  if (!isBigTerminalId(terminalId) || !VALID_STATES.has(status.state)) return
  const state = status.state as AgentStatusState
  const agentType = isKnownAgentType(status.agentType) ? status.agentType : undefined
  const payload: AgentStatusPayload = kind === 'title'
    ? { state, source: 'title', agentType }
    : kind === 'scan'
      ? { state, source: 'terminal_scan', agentType: 'codex' }
      : { ...status, state, agentType, source: 'hook' }
  const applied = applyTerminalStatus(terminalId, payload)
  // Restored history sets the status but must not re-announce old events.
  if (!applied.stateChanged || replayed) return
  if (kind === 'osc') entry?.completionCoordinator.observeHookStatus(state, status.interrupted ?? false)
  else if (kind === 'osc9') entry?.completionCoordinator.observeHookStatus(state, false)
  else if (kind === 'title') entry?.completionCoordinator.observeTitleStatus(state)
  notifyTerminalStateChange(terminalId, state)
}

let listenersRegistered = false

/** Hook callbacks and daemon status events, routed to the store (singleton). */
export function ensureStatusListeners(getEntry: (terminalId: string) => BigTermEntry | undefined): void {
  if (listenersRegistered) return
  listenersRegistered = true
  ipc.pty.onAgentHookStatus((status) => {
    const { terminalId, state, agentType, toolName, interrupted } = status
    if (!VALID_STATES.has(state)) return
    const entry = getEntry(terminalId)
    // With an offloading daemon, background terminals have no xterm (entry):
    // their status still counts. Otherwise only cached terminals, as before.
    if (!entry && !(isOffloadEnabled() && isBigTerminalId(terminalId))) return

    const payload: AgentStatusPayload = {
      state: state as AgentStatusState,
      source: 'hook',
      agentType: (agentType as AgentStatusPayload['agentType']) ?? 'claude',
      toolName: toolName ?? undefined,
    }
    const applied = applyTerminalStatus(terminalId, payload)
    if (entry && payload.agentType === 'codex') {
      ensureCodexPromptScanListener(entry)
      scheduleCodexUserInputScan(entry)
    }
    if (applied.stateChanged) {
      entry?.completionCoordinator.observeHookStatus(payload.state, interrupted ?? false)
      notifyTerminalStateChange(terminalId, payload.state)
    }
  })
  try {
    ipc.pty.onAgentStatus((event) => applyDaemonStatus(event, getEntry(event.terminalId)))
  } catch { /* older preload in tests */ }
}

// ── Renderer-side detection (older daemons only) ────────────────────────────

function isKnownCodexTerminal(entry: BigTermEntry): boolean {
  if (entry.agentId === 'codex') return true
  const status = useUIStore.getState().bigTerminalStatusById[entry.terminalId]
  return status?.agentType === 'codex'
}

function scanCodexUserInputPrompt(entry: BigTermEntry): void {
  entry.codexPromptScanTimer = null
  if (entry.disposed || isOffloadEnabled()) return
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
  if (entry.disposed || isOffloadEnabled() || isReplaying(entry.terminalId)) return
  if (!isKnownCodexTerminal(entry)) return
  if (entry.codexPromptScanTimer) return
  entry.codexPromptScanTimer = setTimeout(() => scanCodexUserInputPrompt(entry), 80)
}

function ensureCodexPromptScanListener(entry: BigTermEntry): void {
  if (entry.codexPromptWriteDisposable) return
  entry.codexPromptWriteDisposable = entry.term.onWriteParsed(() => scheduleCodexUserInputScan(entry))
}

export function updateEntryAgentId(entry: BigTermEntry, agentId?: string): void {
  if (!agentId) return
  entry.agentId = agentId
  if (agentId === 'codex') {
    ensureCodexPromptScanListener(entry)
    scheduleCodexUserInputScan(entry)
  }
}

/**
 * OSC 9999 / OSC 9 / title / Codex detectors on the terminal's xterm. They stay
 * registered, but do nothing while the daemon is the status source, so a
 * daemon swap mid-session (legacy -> capable) never double-fires.
 */
export function registerRendererDetectors(entry: BigTermEntry, expectedAgentType: AgentType | undefined): void {
  const { terminalId, term, completionCoordinator } = entry
  const daemonDetects = (): boolean => isOffloadEnabled()
  const updateStatus = (payload: AgentStatusPayload) => {
    const applied = applyTerminalStatus(terminalId, payload)
    if (payload.agentType === 'codex') {
      ensureCodexPromptScanListener(entry)
      scheduleCodexUserInputScan(entry)
    }
    return applied
  }

  registerAgentStatusOsc(term, (payload) => {
    if (daemonDetects()) return
    const applied = updateStatus({ ...payload, source: 'hook' })
    // Replayed history sets the status but must not re-announce old events.
    if (applied.stateChanged && !isReplaying(terminalId)) {
      completionCoordinator.observeHookStatus(payload.state, payload.interrupted ?? false)
      notifyTerminalStateChange(terminalId, payload.state)
    }
  })

  registerTitleDetection(term, (result) => {
    if (daemonDetects()) return
    const applied = updateStatus({ state: result.state, source: 'title', agentType: result.agentType ?? undefined })
    if (applied.stateChanged && !isReplaying(terminalId)) {
      completionCoordinator.observeTitleStatus(result.state)
      notifyTerminalStateChange(terminalId, result.state)
    }
  }, { expectedAgentType })

  // OSC 9 (Braid hooks): Claude Code hooks return terminalSequence with
  // OSC 9 braid:STATE[:TOOL] payloads. Secondary to HTTP but still useful.
  registerBraidOsc9(term, (payload) => {
    if (daemonDetects()) return
    const applied = updateStatus({ ...payload, source: 'hook' })
    if (applied.stateChanged && !isReplaying(terminalId)) {
      completionCoordinator.observeHookStatus(payload.state, false)
      notifyTerminalStateChange(terminalId, payload.state)
    }
  })

  if (expectedAgentType === 'codex') ensureCodexPromptScanListener(entry)
}
