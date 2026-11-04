// Experimental: shut down agent terminals that have sat finished and unseen
// for a while, to free their processes. A hibernated tab keeps its history and
// its agent's saved session, and resumes the agent when opened again.

import * as ipc from '@/lib/ipc'
import { isKnownAgentType, type AgentType } from '@/lib/agentStatus'
import { useUIStore } from '@/store/ui'
import { hibernateBigTerminal, listBigTerminalActivity } from './bigTerminalCache'

const SWEEP_INTERVAL_MS = 60_000
export const DEFAULT_HIBERNATION_MINUTES = 30

export function clampHibernationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_HIBERNATION_MINUTES
  return Math.min(1440, Math.max(1, Math.round(minutes)))
}

export interface HibernationInput {
  now: number
  idleMs: number
  visibleTerminalId: string | null
  /** Terminals with a saved agent session (otherwise it could not come back). */
  resumableIds: ReadonlySet<string>
  statusById: Record<string, { state: string; source: string; agentType?: string | null } | undefined>
  terminals: ReadonlyArray<{ terminalId: string; lastInputAt: number; lastOutputAt: number; mobileInputLocked: boolean }>
}

/** Terminals safe to hibernate now. Pure, so the rules are testable. */
export function selectHibernationCandidates(input: HibernationInput): Array<{ terminalId: string; agentType?: AgentType }> {
  const result: Array<{ terminalId: string; agentType?: AgentType }> = []
  for (const t of input.terminals) {
    const status = input.statusById[t.terminalId]
    // Only a finished turn confirmed by live detection; never mid-turn.
    if (!status || status.state !== 'done' || status.source === 'restored') continue
    if (t.terminalId === input.visibleTerminalId || t.mobileInputLocked) continue
    if (!input.resumableIds.has(t.terminalId)) continue
    if (input.now - t.lastInputAt < input.idleMs || input.now - t.lastOutputAt < input.idleMs) continue
    const agentType = status.agentType ?? undefined
    result.push(isKnownAgentType(agentType) ? { terminalId: t.terminalId, agentType } : { terminalId: t.terminalId })
  }
  return result
}

function visibleTerminalId(): string | null {
  const ui = useUIStore.getState()
  const wt = ui.selectedWorktreeId
  const view = wt ? ui.activeCenterViewByWorktree[wt] : null
  return view?.type === 'terminal' ? view.terminalId : null
}

async function sweep(): Promise<void> {
  const ui = useUIStore.getState()
  if (!ui.agentHibernation) return
  const terminals = listBigTerminalActivity()
  if (terminals.length === 0) return
  const records = await ipc.pty.listAgentSessions().catch(() => [])
  const candidates = selectHibernationCandidates({
    now: Date.now(),
    idleMs: clampHibernationMinutes(ui.agentHibernationMinutes) * 60_000,
    visibleTerminalId: visibleTerminalId(),
    resumableIds: new Set(records.map((r) => r.terminalId)),
    statusById: useUIStore.getState().bigTerminalStatusById,
    terminals,
  })
  for (const c of candidates) {
    // The phone may be watching without holding input; never pull it away.
    const onPhone = await ipc.pty.isMobileTerminalActive(c.terminalId).catch(() => true)
    if (!onPhone && c.terminalId !== visibleTerminalId()) hibernateBigTerminal(c.terminalId, c.agentType)
  }
}

/** Start the periodic sweep. Returns a stop function. */
export function startAgentHibernation(): () => void {
  const timer = setInterval(() => { void sweep() }, SWEEP_INTERVAL_MS)
  return () => clearInterval(timer)
}
