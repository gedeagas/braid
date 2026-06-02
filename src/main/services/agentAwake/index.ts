// ── Agent-awake service wiring ───────────────────────────────────────────────
//
// Owns the singleton AgentAwakeService and feeds it Braid's agent hook status
// stream: subscribe to per-terminal status changes, keep the latest per
// terminal, and hand the service the full set so it can decide whether to hold a
// sleep blocker. The service itself filters for `working` + non-stale, so we just
// forward what we observe this runtime.

import { onHookStatus } from '../agentHookServer'
import { AgentAwakeService, type AgentAwakeStatus } from './agentAwakeService'

export { AgentAwakeService } from './agentAwakeService'

let service: AgentAwakeService | null = null
let unsubscribeHookStatus: (() => void) | null = null
// Latest observed status per terminalId. Bounded by the number of distinct
// terminals seen this runtime; a closed terminal that never emitted a terminal
// state simply ages out via the service's 2h staleness guard.
const latestByTerminal = new Map<string, AgentAwakeStatus>()

/** Start the singleton service and begin feeding it hook status. Idempotent. */
export function startAgentAwakeService(enabled: boolean): void {
  if (service) {
    service.setEnabled(enabled)
    return
  }
  service = new AgentAwakeService()
  service.setEnabled(enabled)
  service.setStatuses([])
  unsubscribeHookStatus = onHookStatus((status) => {
    // Every hook event is, by definition, observed in the current runtime - Braid
    // doesn't persist/restore statuses across restarts.
    latestByTerminal.set(status.terminalId, {
      state: status.state,
      receivedAt: Date.now(),
      observedInCurrentRuntime: true,
    })
    service?.setStatuses([...latestByTerminal.values()])
  })
}

/** Toggle whether the machine is kept awake while agents work. */
export function setAgentAwakeEnabled(enabled: boolean): void {
  service?.setEnabled(enabled)
}

/** Tear down the service and its subscriptions (on quit). */
export function stopAgentAwakeService(): void {
  unsubscribeHookStatus?.()
  unsubscribeHookStatus = null
  service?.dispose()
  service = null
  latestByTerminal.clear()
}
