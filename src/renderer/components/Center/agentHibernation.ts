// Experimental: shut down agent terminals that have sat finished and unseen
// for a while, to free their processes. A hibernated tab keeps its history and
// its agent's saved session, and resumes the agent when opened again.

import * as ipc from '@/lib/ipc'
import { isKnownAgentType, type AgentType } from '@/lib/agentStatus'
import { useUIStore } from '@/store/ui'
import { clampHibernationMinutes } from '@/lib/agentHibernationConfig'
import { hibernateBigTerminal, listBigTerminalActivity } from './bigTerminalCache'

const SWEEP_INTERVAL_MS = 60_000

export { clampHibernationMinutes } from '@/lib/agentHibernationConfig'

export interface HibernationInput {
  now: number
  idleMs: number
  visibleTerminalId: string | null
  /** Terminals with a saved agent session (otherwise it could not come back). */
  resumableIds: ReadonlySet<string>
  /**
   * Terminals whose PTY runs a command in the foreground (per the daemon). A
   * `done` status can outlive the agent: some agents report SessionEnd as done,
   * others report nothing on exit. Never shut down a bare shell.
   */
  agentForegroundIds: ReadonlySet<string>
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
    if (!input.resumableIds.has(t.terminalId) || !input.agentForegroundIds.has(t.terminalId)) continue
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

async function findCandidates(): Promise<Array<{ terminalId: string; agentType?: AgentType }>> {
  const ui = useUIStore.getState()
  if (!ui.agentHibernation) return []
  const terminals = listBigTerminalActivity()
  if (terminals.length === 0) return []
  const [records, sessions] = await Promise.all([
    ipc.pty.listAgentSessions().catch(() => []),
    ipc.pty.listSessions().catch(() => []),
  ])
  // Read the rest after the awaits: input or a new turn may have arrived.
  const fresh = useUIStore.getState()
  if (!fresh.agentHibernation) return []
  return selectHibernationCandidates({
    now: Date.now(),
    idleMs: clampHibernationMinutes(fresh.agentHibernationMinutes) * 60_000,
    visibleTerminalId: visibleTerminalId(),
    resumableIds: new Set(records.map((r) => r.terminalId)),
    agentForegroundIds: new Set(sessions.filter((s) => s.foreground === 'command').map((s) => s.sessionId)),
    statusById: fresh.bigTerminalStatusById,
    terminals: listBigTerminalActivity(),
  })
}

async function sweep(): Promise<void> {
  for (const c of await findCandidates()) {
    // The phone may be watching without holding input; never pull it away.
    const onPhone = await ipc.pty.isMobileTerminalActive(c.terminalId).catch(() => true)
    if (onPhone) continue
    // The check above awaited: re-run every rule for this terminal right
    // before shutting it down, so a turn that just started is never killed.
    const still = await findCandidates()
    const match = still.find((s) => s.terminalId === c.terminalId)
    if (match) hibernateBigTerminal(match.terminalId, match.agentType)
  }
}

/** Start the periodic sweep. Returns a stop function. */
export function startAgentHibernation(): () => void {
  const timer = setInterval(() => { void sweep() }, SWEEP_INTERVAL_MS)
  return () => clearInterval(timer)
}
