// Typed PTY IPC wrappers (ipc.pty), split out of ipc.ts.

import type { AgentResumeClaim } from '@shared/agent-resume'

import type { DaemonAgentStatusEvent, HeadlessSnapshotResult } from '@shared/terminal-offload'

const api = () => window.api

export const pty = {
  spawn: (cwd: string, envOverrides?: Record<string, string>) => api().pty.spawn(cwd, envOverrides),
  write: (id: string, data: string) => api().pty.write(id, data),
  /** The pty:data listener is up; main holds output until then after a reload. */
  rendererReady: () => api().pty.rendererReady(),
  /** Flow control: running total of output characters processed for `id`. */
  ackData: (id: string, processedTotal: number) => api().pty.ackData(id, processedTotal),
  /** The terminal is shown (true) or hidden (false) in the UI. */
  setVisible: (id: string, visible: boolean) => api().pty.setVisible(id, visible),
  /** Snapshot to show a hidden terminal (null: legacy daemon or session gone). */
  headlessSnapshot: (sessionId: string) => api().pty.headlessSnapshot(sessionId) as Promise<HeadlessSnapshotResult | null>,
  snapshotApplied: (sessionId: string, seq: number) => api().pty.snapshotApplied(sessionId, seq),
  /** Terminal colours, for OSC 10/11/12 replies from hidden terminals. */
  setTerminalColors: (colors: { foreground?: string; background?: string; cursor?: string }) => api().pty.setTerminalColors(colors),
  /** Keep receiving a hidden terminal's output (e.g. until its initial command is typed). */
  setDeliveryInterest: (sessionId: string, interested: boolean) => api().pty.setDeliveryInterest(sessionId, interested),
  /** Agent status detected by the daemon (daemons with status-events). */
  onAgentStatus: (callback: (event: DaemonAgentStatusEvent) => void) => api().pty.onAgentStatus(callback) as () => void,
  /** Terminal backend capabilities (daemon hello features); empty for an older daemon. */
  getFeatures: () => api().pty.getFeatures() as Promise<string[]>,
  onFeaturesChanged: (callback: (features: string[]) => void) => api().pty.onFeaturesChanged(callback) as () => void,
  resize: (id: string, cols: number, rows: number) => api().pty.resize(id, cols, rows),
  kill: (id: string) => api().pty.kill(id),
  runScript: (cwd: string, command: string) => api().pty.runScript(cwd, command),
  readTerminalOutput: (worktreePath: string) => api().pty.readTerminalOutput(worktreePath),
  onData: (callback: (id: string, data: string, noReply?: boolean) => void) => api().pty.onData(callback),
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
  reattach: (sessionId: string, opts?: { snapshot?: boolean }) => api().pty.reattach(sessionId, opts) as Promise<{ sessionId: string; snapshot: string; coldRestored?: boolean; foregroundAtLoss?: 'shell' | 'command' } | null>,
  consumeColdRestore: (sessionId: string) => api().pty.consumeColdRestore(sessionId) as Promise<boolean>,
  listSessions: () => api().pty.listSessions() as Promise<Array<{
    sessionId: string; cwd: string; cols: number; rows: number; createdAt: number; lastOutputAt?: number
    coldRestored?: boolean; foreground?: 'shell' | 'command'
    /** Last status the daemon detected (daemons with status-events). */
    agentStatus?: { state: 'working' | 'blocked' | 'waiting' | 'done'; agentType?: string; toolName?: string; source: 'hook' | 'title' | 'terminal_scan' }
  }>>,
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
