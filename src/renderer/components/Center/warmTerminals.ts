import type { BigTerminalTab } from '@/store/ui/terminals'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import * as ipc from '@/lib/ipc'
import { isKnownAgentType, type AgentType } from '@/lib/agentStatus'
import { getOrCreate } from './bigTerminalCache'

export interface WarmTarget {
  terminalId: string
  worktreePath: string
  agentId?: string
}

/**
 * Pick the persisted big terminals worth reattaching at startup: those whose
 * daemon session is still alive and whose worktree still exists. Dead sessions
 * are skipped on purpose - warming one would spawn a fresh shell nobody asked
 * for. Those still restore their history lazily when the user opens the tab.
 */
export function selectWarmTargets(
  tabsByWorktree: Record<string, BigTerminalTab[]>,
  worktreePaths: ReadonlyMap<string, string>,
  liveSessionIds: ReadonlySet<string>,
): WarmTarget[] {
  const targets: WarmTarget[] = []
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    const worktreePath = worktreePaths.get(worktreeId)
    if (!worktreePath) continue
    for (const tab of tabs) {
      if (!liveSessionIds.has(tab.id)) continue
      targets.push({ terminalId: tab.id, worktreePath, agentId: tab.agentId })
    }
  }
  return targets
}

/**
 * Tabs to show with their last-known agent although they are not reattached:
 * the agent recorded a resumable session and the terminal is cold (restored
 * by the daemon, or gone), so it will come back when the tab is opened.
 */
export function selectRestoredStatusSeeds(
  tabsByWorktree: Record<string, BigTerminalTab[]>,
  records: ReadonlyArray<{ terminalId: string; session?: { agent?: string } }>,
  warmIds: ReadonlySet<string>,
): Array<{ terminalId: string; agentType?: AgentType }> {
  const tabIds = new Set(Object.values(tabsByWorktree).flatMap((tabs) => tabs.map((t) => t.id)))
  const seeds: Array<{ terminalId: string; agentType?: AgentType }> = []
  for (const record of records) {
    if (!tabIds.has(record.terminalId) || warmIds.has(record.terminalId)) continue
    const agent = record.session?.agent
    seeds.push(isKnownAgentType(agent) ? { terminalId: record.terminalId, agentType: agent } : { terminalId: record.terminalId })
  }
  return seeds
}

/**
 * Daemon sessions safe to reattach in the background. Cold-restored ones wait
 * for the user to open their tab: warming one would relaunch its agent unseen,
 * and with many tabs after a reboot that is a resume storm.
 */
export function warmableSessionIds(sessions: ReadonlyArray<{ sessionId: string; coldRestored?: boolean }>): Set<string> {
  return new Set(sessions.filter((s) => !s.coldRestored).map((s) => s.sessionId))
}

/**
 * Reattach every live big terminal in the background on startup, the same way
 * clicking its worktree does. Agent status (and the sidebar agent count) comes
 * from title/OSC detection on the reattached stream, plus hook callbacks that
 * are only routed to cached terminals, so without this a worktree showed no
 * agents until it was opened. Call after projects have loaded so worktree
 * paths can be resolved.
 */
export async function warmLiveBigTerminals(): Promise<number> {
  const liveIds = warmableSessionIds(await ipc.pty.listSessions())
  try {
    const records = await ipc.pty.listAgentSessions()
    const tabs = useUIStore.getState().bigTerminalsByWorktree
    useUIStore.getState().seedRestoredBigTerminalStatus(selectRestoredStatusSeeds(tabs, records, liveIds))
  } catch {
    // Best effort: tabs still restore when opened.
  }
  if (liveIds.size === 0) return 0
  // Read the tabs after the awaits so a tab closed meanwhile is not recreated.
  const tabsByWorktree = useUIStore.getState().bigTerminalsByWorktree

  const worktreePaths = new Map<string, string>()
  for (const project of useProjectsStore.getState().projects) {
    for (const wt of project.worktrees) worktreePaths.set(wt.id, wt.path)
  }

  const targets = selectWarmTargets(tabsByWorktree, worktreePaths, liveIds)
  // Reattach only: a session that died since it was listed waits for its tab
  // to be opened instead of spawning a shell and resuming its agent unseen.
  for (const t of targets) getOrCreate(t.terminalId, t.worktreePath, undefined, t.agentId, undefined, { reattachOnly: true })
  return targets.length
}
