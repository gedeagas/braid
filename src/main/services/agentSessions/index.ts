// Wires the durable agent session store into the app: hooks feed it, the
// renderer claims sessions to resume from it, and quit flushes it.

import { app, ipcMain } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { onHookSessionUpdate, onHookStatus } from '../agentHookServer'
import { AgentSessionStore } from './store'

export { AgentSessionStore } from './store'
export type { AgentSessionRecord } from './store'

export const agentSessionStore = new AgentSessionStore({
  filePath: join(homedir(), '.braid', 'agent-sessions', 'last-status.json'),
})

let started = false

/** Load records and start recording. Call once at startup, before windows open. */
export function startAgentSessionTracking(): void {
  if (started) return
  started = true
  agentSessionStore.load()
  onHookSessionUpdate((update) => agentSessionStore.applySessionUpdate(update))
  onHookStatus((status) => agentSessionStore.noteState(status.terminalId, status.state))
  app.on('before-quit', () => agentSessionStore.markQuitAndFlush())

  ipcMain.handle('agentSessions:claimResume', (_e, terminalId: unknown) =>
    typeof terminalId === 'string' ? agentSessionStore.claimResume(terminalId) : null)
  ipcMain.handle('agentSessions:list', () => agentSessionStore.list())
}
