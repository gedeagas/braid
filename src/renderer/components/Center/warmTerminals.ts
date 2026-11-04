import type { BigTerminalTab } from '@/store/ui/terminals'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import * as ipc from '@/lib/ipc'
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
  if (liveIds.size === 0) return 0

  const worktreePaths = new Map<string, string>()
  for (const project of useProjectsStore.getState().projects) {
    for (const wt of project.worktrees) worktreePaths.set(wt.id, wt.path)
  }

  const targets = selectWarmTargets(useUIStore.getState().bigTerminalsByWorktree, worktreePaths, liveIds)
  for (const t of targets) getOrCreate(t.terminalId, t.worktreePath, undefined, t.agentId)
  return targets.length
}
