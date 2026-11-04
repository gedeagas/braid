// Wires the durable agent session store into the app: hooks feed it, the
// renderer claims sessions to resume from it, and quit flushes it.

import { app, ipcMain } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { onHookSessionUpdate, onHookStatus } from '../agentHookServer'
import { ptyService } from '../pty'
import { AgentSessionStore } from './store'
import { verifyAgentSession } from './verify'
import type { AgentResumeClaim } from '../../../shared/agent-resume'

export { AgentSessionStore } from './store'
export type { AgentSessionRecord } from './store'

export const agentSessionStore = new AgentSessionStore({
  filePath: join(homedir(), '.braid', 'agent-sessions', 'last-status.json'),
})

let started = false

/**
 * Claim the terminal's saved session and check it still exists. A missing one
 * is forgotten: the renderer starts the agent fresh and a later restore must
 * not try the dead id again.
 */
async function claimAndVerify(terminalId: string): Promise<AgentResumeClaim | null> {
  const session = agentSessionStore.claimResume(terminalId)
  if (!session) return null
  const verdict = await verifyAgentSession(session)
  if (verdict === 'missing') agentSessionStore.forget(terminalId)
  return { session, verdict }
}

/** Load records and start recording. Call once at startup, before windows open. */
export function startAgentSessionTracking(): void {
  if (started) return
  started = true
  agentSessionStore.load()
  onHookSessionUpdate((update) => agentSessionStore.applySessionUpdate(update))
  onHookStatus((status) => agentSessionStore.noteState(status.terminalId, status.state))
  app.on('before-quit', () => agentSessionStore.markQuitAndFlush())
  // A shell the user exited must not relaunch its agent later.
  ptyService.onSessionEnded?.((sessionId, selfExit) => {
    if (selfExit) agentSessionStore.forget(sessionId)
  })

  ipcMain.handle('agentSessions:claimResume', (_e, terminalId: unknown) =>
    typeof terminalId === 'string' ? claimAndVerify(terminalId) : null)
  ipcMain.handle('agentSessions:list', () => agentSessionStore.list())
  // The renderer learned the user had left the agent before the loss.
  ipcMain.on('agentSessions:forget', (_e, terminalId: unknown) => {
    if (typeof terminalId === 'string') agentSessionStore.forget(terminalId)
  })
}
