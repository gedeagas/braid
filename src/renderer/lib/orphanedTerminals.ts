import * as ipc from '@/lib/ipc'

interface OrphanedTerminal {
  terminalId: string
}

/**
 * Reap daemon-backed terminal sessions that are not present in the renderer's
 * persisted terminal ids. Main process code still rechecks attachment state
 * immediately before killing, so this is safe to run during startup.
 */
export async function reapOrphanedTerminals(knownTerminalIds: string[]): Promise<number> {
  if (!await ipc.shell.isPackaged()) return 0

  const knownIds = [...new Set(knownTerminalIds)]
  const orphans = await ipc.pty.listOrphanedBigTerminals(knownIds) as OrphanedTerminal[]
  if (orphans.length === 0) return 0

  const orphanIds = [...new Set(orphans.map((orphan) => orphan.terminalId))]
  if (orphanIds.length === 0) return 0
  return ipc.pty.killOrphanedBigTerminals(orphanIds)
}
