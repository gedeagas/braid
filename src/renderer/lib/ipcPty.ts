// Typed PTY IPC wrappers (ipc.pty), split out of ipc.ts.

import type { AgentResumeClaim } from '@shared/agent-resume'

const api = () => window.api

export const pty = {
  spawn: (cwd: string, envOverrides?: Record<string, string>) => api().pty.spawn(cwd, envOverrides),
  write: (id: string, data: string) => api().pty.write(id, data),
  /** The pty:data listener is up; main holds output until then after a reload. */
  rendererReady: () => api().pty.rendererReady(),
  /** Flow control: running total of output characters processed for `id`. */
  ackData: (id: string, processedTotal: number) => api().pty.ackData(id, processedTotal),
  /** Terminal backend capabilities (daemon hello features); empty for an older daemon. */
  getFeatures: () => api().pty.getFeatures(),
  onFeaturesChanged: (callback: (features: string[]) => void) => api().pty.onFeaturesChanged(callback),
  resize: (id: string, cols: number, rows: number) => api().pty.resize(id, cols, rows),
  kill: (id: string) => api().pty.kill(id),
  runScript: (cwd: string, command: string) => api().pty.runScript(cwd, command),
  readTerminalOutput: (worktreePath: string) => api().pty.readTerminalOutput(worktreePath),
  onData: (callback: (id: string, data: string) => void) => api().pty.onData(callback),
  onExit: (callback: (id: string, exitCode: number) => void) => api().pty.onExit(callback),
  registerBigTerminal: (ptyId: string, terminalId: string) => api().pty.registerBigTerminal(ptyId, terminalId),
  setBigTerminalMetadata: (metadata: { terminalId: string; worktreeId?: string; label?: string; agentId?: string }) =>
    api().pty.setBigTerminalMetadata(metadata),
  removeBigTerminalMetadata: (terminalId: string) => api().pty.removeBigTerminalMetadata(terminalId),
  killBigTerminal: (terminalId: string) => api().pty.killBigTerminal(terminalId),
  renameBigTerminal: (payload: { terminalId: string; worktreeId?: string; label: string; agentId?: string }) =>
    api().pty.renameBigTerminal(payload),
  readScrollback: (terminalId: string) => api().pty.readScrollback(terminalId) as Promise<string>,
  isMobileTerminalActive: (terminalId: string) => api().pty.isMobileTerminalActive(terminalId) as Promise<boolean>,
  setMobileDisplayMode: (terminalId: string, mode: 'phone' | 'desktop') =>
    api().pty.setMobileDisplayMode(terminalId, mode),
  deleteScrollback: (terminalId: string) => api().pty.deleteScrollback(terminalId),
  reattach: (sessionId: string) => api().pty.reattach(sessionId) as Promise<{ sessionId: string; snapshot: string; coldRestored?: boolean; foregroundAtLoss?: 'shell' | 'command' } | null>,
  consumeColdRestore: (sessionId: string) => api().pty.consumeColdRestore(sessionId) as Promise<boolean>,
  listSessions: () => api().pty.listSessions() as Promise<Array<{ sessionId: string; cwd: string; cols: number; rows: number; createdAt: number; coldRestored?: boolean; foreground?: 'shell' | 'command' }>>,
  listOrphanedBigTerminals: (knownTerminalIds: string[]) =>
    api().pty.listOrphanedBigTerminals(knownTerminalIds) as Promise<Array<{ terminalId: string; cwd: string; label?: string; agentId?: string }>>,
  killOrphanedBigTerminals: (terminalIds: string[]) =>
    api().pty.killOrphanedBigTerminals(terminalIds) as Promise<number>,
  setKnownBigTerminals: (items: Array<{ terminalId: string; label?: string; agentId?: string; worktreeId?: string }>) =>
    api().pty.setKnownBigTerminals(items),
  onAgentHookStatus: (callback: (status: { terminalId: string; state: string; agentType: string; toolName?: string; interrupted?: boolean }) => void) =>
    api().pty.onAgentHookStatus(callback),
  /** Saved agent conversation to relaunch in this terminal (one claim per provider session). */
  claimAgentResume: (terminalId: string) => api().pty.claimAgentResume(terminalId) as Promise<AgentResumeClaim | null>,
  listAgentSessions: () => api().pty.listAgentSessions() as Promise<Array<{ terminalId: string; session: { agent: string; id: string }; state?: string }>>,
  /** The user had left the agent before the terminal was lost: never resume it. */
  forgetAgentResume: (terminalId: string) => api().pty.forgetAgentResume(terminalId),
  onMobileTerminalActive: (callback: (status: { terminalId: string; active: boolean }) => void) =>
    api().pty.onMobileTerminalActive(callback),
  onMobileDisplayMode: (callback: (status: { terminalId: string; mode: 'phone' | 'desktop' }) => void) =>
    api().pty.onMobileDisplayMode(callback),
  onMobileFit: (callback: (status: { terminalId: string; cols: number; rows: number }) => void) =>
    api().pty.onMobileFit(callback),
  onBigTerminalRegistered: (callback: (tab: { terminalId: string; worktreeId?: string; worktreePath?: string; label?: string; agentId?: string }) => void) =>
    api().pty.onBigTerminalRegistered(callback),
  onBigTerminalRenamed: (callback: (tab: { terminalId: string; worktreeId?: string; worktreePath?: string; label: string }) => void) =>
    api().pty.onBigTerminalRenamed(callback),
  onBigTerminalClosed: (callback: (tab: { terminalId: string; worktreeId?: string; worktreePath?: string }) => void) =>
    api().pty.onBigTerminalClosed(callback),
}
