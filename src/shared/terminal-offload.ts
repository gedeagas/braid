// Types for hidden-terminal offload, shared by main, preload and renderer.
// With a daemon that keeps screen state (features headless-snapshot +
// status-events), hidden terminals get no output; they are restored from a
// snapshot when shown, and agent status comes from the daemon.

export const OFFLOAD_FEATURES = ['headless-snapshot', 'status-events'] as const

export interface HeadlessSnapshotData {
  upToDate?: false
  /** Write after term.reset(): screen, modes, cursor, title, unfinished escape. */
  data: string
  cols: number
  rows: number
  /** Confirm with this; live output after it follows. */
  seq: number
  title: string
  /** OSC 8 hyperlinks (absolute rows of the active buffer), which the serialized text drops. */
  links?: Array<{ row: number; startCol: number; endCol: number; uri: string }>
  /** The final screen of a PTY that exited while hidden. */
  exited?: true
}

/** `upToDate`: the renderer's xterm missed nothing, no snapshot needed. */
export type HeadlessSnapshotResult = HeadlessSnapshotData | { upToDate: true }

export interface DaemonAgentStatusEvent {
  terminalId: string
  kind: 'osc' | 'osc9' | 'title' | 'scan'
  status: {
    state: 'working' | 'blocked' | 'waiting' | 'done'
    agentType?: string
    toolName?: string
    toolInput?: string
    lastAssistantMessage?: string
    prompt?: string
    interrupted?: boolean
  }
  /** From restored history: set the status, but don't announce it. */
  replayed: boolean
}
