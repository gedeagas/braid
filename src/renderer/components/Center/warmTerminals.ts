import type { BigTerminalTab } from '@/store/ui/terminals'
import { useUIStore } from '@/store/ui'
import { useProjectsStore } from '@/store/projects'
import * as ipc from '@/lib/ipc'
import { isKnownAgentType, type AgentType } from '@/lib/agentStatus'
import { ensureBigTerminalStatusListeners, getOrCreate, hasBigTerminal, registerWarmBigTerminal } from './bigTerminalCache'
import { applyTerminalStatus } from './bigTerminalStatus'
import { initPtyFeatures, isOffloadEnabled } from '@/lib/ptyFeatures'
import { syncShown } from '@/lib/ptyOutput/visibility'

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
 * Reattach every live big terminal in the background on startup. With an
 * older daemon this builds each xterm, the same way clicking its worktree does. Agent status (and the sidebar agent count) comes
 * from title/OSC detection on the reattached stream, plus hook callbacks that
 * are only routed to cached terminals, so without this a worktree showed no
 * agents until it was opened. Call after projects have loaded so worktree
 * paths can be resolved.
 */
export async function warmLiveBigTerminals(): Promise<number> {
  await initPtyFeatures()
  const offload = isOffloadEnabled()
  const sessions = await ipc.pty.listSessions()
  const liveIds = warmableSessionIds(sessions)
  if (offload) {
    // Warm terminals get no xterm, so nothing else would subscribe to status.
    ensureBigTerminalStatusListeners()
    // A daemon with status-events already knows each terminal's agent status.
    seedDaemonStatuses(sessions, liveIds)
  }
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
  if (offload) {
    // Status comes from the daemon: attach in main only (output mirror for
    // scrollback, mobile), no xterm and no WebGL. The xterm is built when the
    // tab is opened, from the daemon's screen snapshot.
    await Promise.all(targets.map((t) => warmWithoutXterm(t.terminalId)))
    return targets.length
  }
  // Reattach only: a session that died since it was listed waits for its tab
  // to be opened instead of spawning a shell and resuming its agent unseen.
  for (const t of targets) getOrCreate(t.terminalId, t.worktreePath, undefined, t.agentId, undefined, { reattachOnly: true })
  return targets.length
}

type ListedSession = Awaited<ReturnType<typeof ipc.pty.listSessions>>[number]

/** Show the last status the daemon detected for each live tab, right at startup. */
function seedDaemonStatuses(sessions: readonly ListedSession[], liveIds: ReadonlySet<string>): void {
  for (const s of sessions) {
    const status = s.agentStatus
    if (!status || !liveIds.has(s.sessionId) || !s.sessionId.startsWith('bt-')) continue
    const agentType = isKnownAgentType(status.agentType) ? status.agentType : undefined
    applyTerminalStatus(s.sessionId, { state: status.state, source: status.source, agentType, toolName: status.toolName })
  }
}

async function warmWithoutXterm(terminalId: string): Promise<void> {
  // Opened by the user (before or while this attaches): its own connect owns
  // the session, and reporting it hidden here would stop its live output.
  if (hasBigTerminal(terminalId)) return
  try {
    const result = await ipc.pty.reattach(terminalId, { snapshot: false })
    if (!result || hasBigTerminal(terminalId)) return
    // Hidden: main sends none of its output (the daemon keeps the screen).
    syncShown({ ptyId: result.sessionId, shown: false })
    ipc.pty.registerBigTerminal(result.sessionId, terminalId)
    registerWarmBigTerminal(terminalId, result.sessionId)
  } catch {
    // Best effort: the tab still restores when opened.
  }
}
