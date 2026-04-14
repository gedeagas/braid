import type { ChildProcess } from 'child_process'

// ─── Public types ────────────────────────────────────────────────────────────

export type LspServerStatus = 'stopped' | 'starting' | 'indexing' | 'ready' | 'error'

export type LspInstallCandidate =
  | { type: 'command'; prereq: string; command: string[]; label: string }
  | { type: 'download'; urls: Record<string, string>; decompress?: 'gz'; label: string }

export interface LspServerConfig {
  id: string
  label: string
  command: string
  args: string[]
  extensions: string[]
  detectFiles: string[]
  languageId: string
  builtin?: boolean
  installCandidates?: LspInstallCandidate[]
  installHint?: string
}

export interface LspDetectedServer {
  config: LspServerConfig
  installed: boolean
  installVia?: string
  /** Nearest ancestor directory containing one of config.detectFiles */
  resolvedRoot?: string
}

export interface LspDiagnostic {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
  message: string
  severity: 1 | 2 | 4 | 8  // Monaco: Hint=1, Info=2, Warning=4, Error=8
  code?: string | number
  source?: string
}

export interface LspHoverResult {
  contents: string
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

export interface LspLocation {
  filePath: string
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

export interface LspRenameResult {
  edits: Array<{ filePath: string; startLine: number; startCol: number; endLine: number; endCol: number; newText: string }>
}

// ─── Internal types ──────────────────────────────────────────────────────────

export interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface ServerInstance {
  process: ChildProcess
  config: LspServerConfig
  projectRoot: string
  status: LspServerStatus
  requestId: number
  pending: Map<number, PendingRequest>
  buffer: Buffer
  initialized: boolean
  openDocuments: Map<string, { version: number; languageId: string }>
  diagnosticsCache: Map<string, LspDiagnostic[]>
  readyTimer?: ReturnType<typeof setTimeout>
}
